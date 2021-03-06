import path from 'path';
import {readFile, getDistPath, writeFile, amazingCache, info, error} from './utils';
import compilerLoader from './loader';
import {AsyncSeriesHook} from 'tapable';
import logger from './helpers/logger';

export default class CStyle {
    constructor(src, dist, ext, options) {
        this.current = process.cwd();
        this.src = src;
        this.dist = dist;
        this.ext = ext;

        this.$sourceType = 'style';
        this.options = options || {};
        this.hooks = {
            optimizeAssets: new AsyncSeriesHook(['opath', 'compilation']),
        };
    }

    compile(rst, opath) {
        if (typeof rst === 'string') {
            rst = [{
                type: rst,
                code: readFile(path.join(opath.dir, opath.base)) || '',
            }];
        }

        let promises = rst.map((style)=>{
            const content = style.code;

            let compiler = compilerLoader.get(style.type);

            if (compiler == null) {
                logger.error('找不到编译器');
                logger.error(opath.dir+path.sep+opath.base);

                return Promise.resolve('');
            }

            return amazingCache({
                source: content,
                options: {configs: compiler.configs},
                transform: function(source, options) {
                    return compiler.parse(content, options.configs, path.join(opath.dir, opath.base));
                },
            });
        });

        return Promise.all(promises).then((rets)=>{
            let allContent = rets.join('');

            this.code = allContent;
            this.hooks.optimizeAssets
            .promise(opath, this)
            .then((err)=>{
                if (err) return Promise.reject(err);

                let target = getDistPath(opath, 'wxss', this.src, this.dist);
                // console.log(target);
                logger.info('write', path.relative(this.current, target));
                writeFile(target, this.code);
            });
        }, this.options.cache).catch((e)=>{
            logger.errorNow('Error In: '+path.join(opath.dir, opath.base), e);
        });
    }
}

