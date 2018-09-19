import 'babel-polyfill';

import {getConfig, getFiles, readFile, isFile} from './utils';
import path from 'path';
import chokidar from 'chokidar';
import schedule from './schedule';
import logger from './helpers/logger';
import compilerLoader from './loader';
import compiler from './compilers/index';
import debugPKG from 'debug';
import {green} from 'chalk';
import defaultPret from './const/defaultPret';
import Optimizer from './optimizer';
import Generator from './generator';
import Compiler from './compilers/index';

let debug = debugPKG('WXA:Builder');

class Builder {
    constructor(src, dist, ext) {
        this.current = process.cwd();
        this.src = src || 'src';
        this.dist = dist || 'dist';
        this.ext = ext || '.wxa';
        this.isWatching = false;
        this.isWatchReady = false;
        this.queue = {};
    }
    // 找到引用的src文件
    findReference(file) {
        let files = getFiles(this.src);

        let refs = [];

        let reg = new RegExp('\\'+this.ext+'$');

        files = files.filter((f)=>reg.test(f));

        files.forEach((f)=>{
            let opath = path.parse(path.join(this.current, this.src, f));
            // console.log(opath);
            let content = readFile(opath);

            content.replace(/<(script|template|style)\s.*src\s*src=\s*['"](.*)['"]/ig, (match, tag, srcpath)=>{
                if (path.join(opath.dir, srcpath) === path.join(this.current, src, file)) {
                    refs.push(f);
                }
            });
        });

        return refs;
    }
    init(cmd) {
        // 加载编译器
        const configs = getConfig();
        schedule.set('wxaConfigs', configs || {});

        // mount loader
        return compilerLoader
        .mount(configs.use, cmd);
    }
    watch(cmd) {
        if (this.isWatching) return;
        this.isWatching = true;

        // set mode
        schedule.set('mode', 'watch');

        chokidar.watch(`.${path.sep}${this.src}`, {
            awaitWriteFinish: {
                stabilityThreshold: 300,
                pollInterval: 100,
            },
        })
        .on('all', (event, filepath)=>{
            if (this.isWatchReady && ['change', 'add'].indexOf(event)>-1 && !this.queue[filepath]) {
                cmd.file = path.join('..', filepath);
                // schedule
                logger.message(event, filepath, true);
                this.queue[filepath] = event;
                cmd.category = event;
                this.build(cmd);
                setTimeout(()=>this.queue[filepath]=false, 500);
            }
        })
        .on('ready', (event, filepath)=>{
            this.isWatchReady = true;
            logger.message('Watch', '准备完毕，开始监听文件', true);
        });
    }
    async build(cmd) {
        let config = getConfig();

        config.source = this.src;
        config.dist = this.dist;
        config.ext = this.ext;

        let file = cmd.file;
        let files = file ? [file] : getFiles(this.src);

        schedule.set('src', this.src);
        schedule.set('dist', this.dist);
        schedule.set('options', cmd);

        logger.infoNow('Compile', 'AT: '+new Date().toLocaleString(), void(0));

        // find app.js、 app.wxa first
        let appJSON = path.join(this.current, this.src, 'app.json');
        let appJS = path.join(this.current, this.src, 'app.js');
        let wxaJSON = path.join(this.current, this.src, 'app'+this.ext);
        let isWXA = false;
        if (isFile(appJSON)) {
            isWXA = false;
        } else if (!isFile(appJSON) && isFile(wxaJSON)) {
            isWXA = true;
        } else {
            logger.errorNow('不存在app.json或app.wxa文件!');
        }

        try {
            // initial loader.
            await this.init(cmd);

            // read entry file.
            let entryMdl = {
                src: wxaJSON,
                type: 'wxa',
                category: 'App',
                pret: defaultPret,
            };
            let p;
            if (isWXA) {
                p = ()=>{
                    let compiler = new Compiler(schedule.wxaConfigs.resolve, schedule.meta);
                    return compiler.$parse(void(0), void(0), wxaJSON, 'wxa', entryMdl);
                };
            } else {
                p = ()=>Promise.resolve({
                    script: {
                        code: readFile(appJS),
                    },
                    config: {
                        code: readFile(appJSON),
                    },
                });
            }

            let ret = await p();
            let rst = ret.rst || ret;
            entryMdl.rst = rst;

            let appConfigs = JSON.parse(rst.config.code);
            // mount to schedule.
            schedule.set('appConfigs', appConfigs);
            schedule.set('$pageArray', [entryMdl]);

            // do dependencies analysis.
            await schedule.doDPA();
            debug('schedule dependencies Tree is %O', schedule.$indexOfModule);

            // module optimize, dependencies merge, minor.
            let optimizer = new Optimizer(schedule.wxaConfigs.resolve, schedule.meta);
            let optimizeTasks = schedule.$indexOfModule.map((dep)=>{
                return optimizer.do(dep);
            });

            await Promise.all(optimizeTasks);

            // module dest, dependencies copy,
            let generator = new Generator(schedule.wxaConfigs.resolve, schedule.meta);
            let generateTasks = schedule.$indexOfModule.map((mdl)=>{
                return generator.do(mdl);
            });

            await Promise.all(generateTasks);

            // done.
        } catch (e) {
            console.error(e);
        }

        if (cmd.category) delete cmd.category;
    }
}


export default Builder;