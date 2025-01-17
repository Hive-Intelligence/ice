/* eslint-disable no-underscore-dangle, no-useless-escape */

const assert = require('assert');
const ConcatSource = require('webpack-sources').ConcatSource;
const fs = require('fs');
const path = require('path');
const sass = require('node-sass');
const convertCharStr2CSS = require('../utils/convertCharStr');

/* eslint no-console: 0 */

function compileSass(srcPath, variableFile, coreVarCode) {
  srcPath = String(srcPath);
  let scssContent = '';
  const basePath = path.resolve(srcPath, '..');
  try {
    scssContent = fs.readFileSync(srcPath, 'utf-8');
  } catch (err) {
    return ''; // ENEONT 文件不存在
  }
  if (variableFile) {
    try {
      const variableFileContent = fs.readFileSync(variableFile, 'utf-8');
      if (variableFileContent) {
        scssContent = variableFileContent + coreVarCode + scssContent;
      }
    } catch (err) {
      // do nothing
    }
  }

  let cssResult = null;
  try {
    cssResult = sass.renderSync({
      data: scssContent,
      includePaths: [basePath],
    });
  } catch (err) {
    console.error(
      '[WARNING]: 编译 Icon 出错，构建继续。错误详细信息：',
      err.stack,
    );
    return '';
  }

  let css = '';
  try {
    css = cssResult.css
      .toString('utf-8') // 这里 result 是个对象，css 是个 buffer
      .replace(/content:\s*(?:\'|\")([\u0080-\uffff])(?:\'|\")/g, (str, $1) => {
        return `content: "${convertCharStr2CSS($1)}"`;
      });
  } catch (err) {
    return '';
  }
  return css.replace(/^@charset "UTF-8";/, ''); // 第一行 charset 去掉
}

module.exports = class AppendStylePlugin {
  constructor(options) {
    assert.ok(
      Object.prototype.toString.call(options) === '[object Object]',
      'First arg: "options" in constructor of AppendStylePlugin should be an object.',
    );

    // ENUM: ['header', 'footer'], 默认 footer，既追加在源 CSS 底部。
    this.appendPosition = options.appendPosition || 'footer';
    this.type = options.type || 'sass'; // 源文件类型
    this.srcFile = options.srcFile; // 源文件
    this.variableFile = options.variableFile; // scss 变量文件
    this.compileThemeIcon = options.compileThemeIcon; // 是否为主题的 icons.scss
    this.themeConfig = options.themeConfig; // themeConfig 配置
    this.distMatch =
      options.distMatch instanceof RegExp // chunkName 去匹配的逻辑，正则或者函数
        ? (chunkName) => options.distMatch.test(chunkName)
        : options.distMatch;
  }

  apply(compiler) {
    const srcFile = String(this.srcFile);
    const distMatch = this.distMatch;
    const variableFile = this.variableFile;
    const compilerEntry = compiler.options.entry;
    if (!srcFile || !distMatch) {
      return;
    }

    compiler.hooks.compilation.tap('compilation', (compilation) => {
      const processEntryChunk = (chunks, done) => {
        chunks.forEach((chunk) => {
          chunk.files.forEach((fileName) => {
            if (
              distMatch(
                fileName,
                compilerEntry,
                compilation.preparedEntrypoints || compilation._preparedEntrypoints,
              )
            ) {
              const css = this.compileToCSS(srcFile, variableFile);
              this.wrapFile(compilation, fileName, css);
            }
          });
        });
        done();
      };
      // compatible with webpack 5
      if (typeof compilation.hooks.processAssets !== 'undefined') {
        // eslint-disable-next-line global-require
        const { Compilation } = require('webpack');
        compilation.hooks.processAssets.tapAsync({
          name: 'optimize-chunk-assets',
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
        }, processEntryChunk);
      } else {
        compilation.hooks.optimizeChunkAssets.tapAsync(
          'optimize-chunk-assets',
          processEntryChunk,
        );
      }
    });
  }

  wrapFile(compilation, fileName, content) {
    // 默认按照底部添加的来
    if (this.appendPosition === 'header') {
      compilation.assets[fileName] = new ConcatSource(
        String(content),
        compilation.assets[fileName],
      );
    } else {
      compilation.assets[fileName] = new ConcatSource(
        compilation.assets[fileName],
        String(content),
      );
    }
  }

  compileToCSS(srcFile, themeVariableFile) {
    if (this.type === 'sass') {
      const themeConfig = this.themeConfig || {};
      let coreVarCode = '';

      if (this.compileThemeIcon) {
        // 1.x 主题包的 icons.scss 里使用了 css-prefix 变量，因此这里需要手动声明下
        // 即便不手动声明，这里也需要支持自定义 css-prefix 能力
        const cssPrefix = themeConfig.nextPrefix || 'next-';
        coreVarCode = `$css-prefix: '${cssPrefix}';`;
      }

      return compileSass(srcFile, themeVariableFile, coreVarCode);
    }
    let css = '';
    try {
      css = fs.readFileSync(srcFile, 'utf-8');
    } catch (err) {
      return '';
    }
    return css;
  }
};
