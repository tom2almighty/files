---
title: Hexo自用外挂标签文档
date: 2024-04-24 10:34:26
tags:
- Hexo
categories:
- 建站
cover: https://image.dooo.ng/c/2024/04/25/6629cdbbb38c1.webp
abbrlink: hexo-tag-doc
description: 自用的Hexo标签文档。
---

## 前言

`Butterfly` 主题的外挂标签较少，没有常用的 `Github` 仓库标签等，因此使用 `hexo-buterfly-tag-plugins-plus` 插件以支持更多外挂标签，并且记录常用示例方便使用。 

原生 `Butterfly` 主题不支持部分标签外挂，若想使用，参考 [Tag Plugins Plus](https://akilar.top/posts/615e2dec/)

仓库地址如下：

{% ghcard Akilarlxh/hexo-butterfly-tag-plugins-plus, theme=onedark%} 

本文档源码下载：

{% btns rounded %}
{% cell 下载源码, https://raw.githubusercontent.com/tom2almighty/files/master/hexo-tag-doc.md, fas fa-download %}
{% endbtns %}

## 安装

博客根目录下安装插件：

```bash
npm install hexo-butterfly-tag-plugins-plus --save
```

考虑到 `hexo` 自带的 `markdown` 渲染插件 `hexo-renderer-marked` 与外挂标签语法的兼容性较差，建议将其替换成 [hexo-renderer-kramed](https://www.npmjs.com/package/hexo-renderer-kramed)

```bash
npm uninstall hexo-renderer-marked --save
npm install hexo-renderer-kramed --save
```

在站点配置文件 `_config.yml` 或主题配置文件 `_config.butterfly.yml` 中添加配置信息

```yaml
# tag-plugins-plus
# see https://akilar.top/posts/615e2dec/
tag_plugins:
  enable: true # 开关
  priority: 5 #过滤器优先权
  issues: false #issues标签依赖注入开关
  link:
    placeholder: /img/link.png #link_card标签默认的图标图片
  CDN:
    anima: https://npm.elemecdn.com/hexo-butterfly-tag-plugins-plus@latest/lib/assets/font-awesome-animation.min.css #动画标签anima的依赖
    jquery: https://npm.elemecdn.com/jquery@latest/dist/jquery.min.js #issues标签依赖
    issues: https://npm.elemecdn.com/hexo-butterfly-tag-plugins-plus@latest/lib/assets/issues.js #issues标签依赖
    iconfont: //at.alicdn.com/t/font_2032782_8d5kxvn09md.js #参看https://akilar.top/posts/d2ebecef/
    carousel: https://npm.elemecdn.com/hexo-butterfly-tag-plugins-plus@latest/lib/assets/carousel-touch.js
    tag_plugins_css: https://npm.elemecdn.com/hexo-butterfly-tag-plugins-plus@latest/lib/tag_plugins.css
```

**配置参数**

| 参数                | 备选值 / 类型                       | 释义                                                         |
| ------------------- | ----------------------------------- | ------------------------------------------------------------ |
| enable              | true/false                          | 【必选】控制开关                                             |
| priority            | number                              | 【可选】过滤器优先级，数值越小，执行越早，默认为 10，选填    |
| issues              | true/false                          | 【可选】issues 标签控制开关，默认为 false                    |
| link.placeholder    | 【必选】link 卡片外挂标签的默认图标 |                                                              |
| CDN.anima           | URL                                 | 【可选】动画标签 anima 的依赖                                |
| CDN.jquery          | URL                                 | 【可选】issues 标签依赖                                      |
| CDN.issues          | URL                                 | 【可选】issues 标签依赖                                      |
| CDN.iconfont        | URL                                 | 【可选】iconfont 标签 symbol 样式引入，如果不想引入，则设为 false |
| CDN.carousel        | URL                                 | 【可选】carousel 旋转相册标签鼠标拖动依赖，如果不想引入则设为 false |
| CDN.tag_plugins_css | URL                                 | 【可选】外挂标签样式的 CSS 依赖，为避免 CDN 缓存延迟，建议将 @latest 改为具体版本号 |

## Front-matter

`Front-matter` 是 `markdown` 文件最上方以 `---` 分隔的区域，用于指定个别页面的参数。

- `Page Front-matter` 用于页面配置
- `Post Front-matter` 用于文章页配置

| 写法              | 解释                                                         |
| ----------------- | ------------------------------------------------------------ |
| title             | 【必需】页面标题                                             |
| date              | 【必需】页面创建日期                                         |
| type              | 【必需】标签、分类和友情链接三个页面需要配置                 |
| updated           | 【可选】页面更新日期                                         |
| description       | 【可选】页面描述                                             |
| keywords          | 【可选】页面关键字                                           |
| comments          | 【可选】显示页面评论模块 (默认 `true`)                       |
| top\_img          | 【可选】页面顶部图片                                         |
| mathjax           | 【可选】显示 `mathjax` (当设置 `mathjax` 的 `per\_page: false` 时，才需要配置，默认 `false`) |
| katex             | 【可选】显示 `katex` (当设置 `katex` 的 `per\_page: false` 时，才需要配置，默认 `false`) |
| aside             | 【可选】显示侧边栏 (默认 `true`)                             |
| aplayer           | 【可选】在需要的页面加载 `aplayer` 的 `js` 和 `css`, 请参考文章下面的`音乐` 配置 |
| highlight\_shrink | 【可选】配置代码框是否展开 (`true/false`)(默认为设置中 `highlight\_shrink` 的配置) |

## Post Front-matter

| 写法                    | 解释                                                         |
| ----------------------- | :----------------------------------------------------------- |
| title                   | 【必需】文章标题                                             |
| date                    | 【必需】文章创建日期                                         |
| updated                 | 【可选】文章更新日期                                         |
| tags                    | 【可选】文章标签                                             |
| categories              | 【可选】文章分类                                             |
| keywords                | 【可选】文章关键字                                           |
| description             | 【可选】文章描述                                             |
| top\_img                | 【可选】文章顶部图片                                         |
| cover                   | 【可选】文章缩略图(如果沒有设置top\_img,文章页顶部将显示缩略图，可设为false/图片地址/留空) |
| comments                | 【可选】显示文章评论模块(默认 true)                          |
| toc                     | 【可选】显示文章TOC(默认为设置中toc的enable配置)             |
| toc\_number             | 【可选】显示toc\_number(默认为设置中toc的number配置)         |
| copyright               | 【可选】显示文章版权模块(默认为设置中post\_copyright的enable配置) |
| copyright\_author       | 【可选】文章版权模块的`文章作者`                             |
| copyright\_author\_href | 【可选】文章版权模块的`文章作者`链接                         |
| copyright\_url          | 【可选】文章版权模块的`文章链接`链接                         |
| copyright\_info         | 【可选】文章版权模块的`版权声明`文字                         |
| mathjax                 | 【可选】显示 mathjax (当设置 mathjax 的 per\_page: false时，才需要配置，默认 false) |
| katex                   | 【可选】显示 katex (当设置 katex 的 per\_page: false 时，才需要配置，默认 false) |
| aplayer                 | 【可选】在需要的页面加载 aplayer 的 js 和 css                |
| highlight\_shrink       | 【可选】配置代码框是否展开(true/false)(默认为设置中highlight\_shrink的配置) |
| aside                   | 【可选】显示侧边栏 (默认 true)                               |

## 标签外挂

### Note

{% tabs %}
<!-- tab simple -->

```markdown
{% note simple %}
默认 提示块标签
{% endnote %}

{% note default simple %}
default 提示块标签
{% endnote %}

{% note primary simple %}
primary 提示块标签
{% endnote %}

{% note success simple %}
success 提示块标签
{% endnote %}

{% note info simple %}
info 提示块标签
{% endnote %}

{% note warning simple %}
warning 提示块标签
{% endnote %}

{% note danger simple %}
danger 提示块标签
{% endnote %}
```
{% note simple %}
默认 提示块标签
{% endnote %}

{% note default simple %}
default 提示块标签
{% endnote %}

{% note primary simple %}
primary 提示块标签
{% endnote %}

{% note success simple %}
success 提示块标签
{% endnote %}

{% note info simple %}
info 提示块标签
{% endnote %}

{% note warning simple %}
warning 提示块标签
{% endnote %}

{% note danger simple %}
danger 提示块标签
{% endnote %}
<!-- endtab -->

<!-- tab modern -->
```markdown
{% note modern %}
默认 提示块标签
{% endnote %}

{% note default modern %}
default 提示块标签
{% endnote %}

{% note primary modern %}
primary 提示块标签
{% endnote %}

{% note success modern %}
success 提示块标签
{% endnote %}

{% note info modern %}
info 提示块标签
{% endnote %}

{% note warning modern %}
warning 提示块标签
{% endnote %}

{% note danger modern %}
danger 提示块标签
{% endnote %}
```
{% note modern %}
默认 提示块标签
{% endnote %}

{% note default modern %}
default 提示块标签
{% endnote %}

{% note primary modern %}
primary 提示块标签
{% endnote %}

{% note success modern %}
success 提示块标签
{% endnote %}

{% note info modern %}
info 提示块标签
{% endnote %}

{% note warning modern %}
warning 提示块标签
{% endnote %}

{% note danger modern %}
danger 提示块标签
{% endnote %}
<!-- endtab -->

<!-- tab flat -->
```markdown
{% note flat %}
默认 提示块标签
{% endnote %}

{% note default flat %}
default 提示块标签
{% endnote %}

{% note primary flat %}
primary 提示块标签
{% endnote %}

{% note success flat %}
success 提示块标签
{% endnote %}

{% note info flat %}
info 提示块标签
{% endnote %}

{% note warning flat %}
warning 提示块标签
{% endnote %}

{% note danger flat %}
danger 提示块标签
{% endnote %}
```
{% note flat %}
默认 提示块标签
{% endnote %}

{% note default flat %}
default 提示块标签
{% endnote %}

{% note primary flat %}
primary 提示块标签
{% endnote %}

{% note success flat %}
success 提示块标签
{% endnote %}

{% note info flat %}
info 提示块标签
{% endnote %}

{% note warning flat %}
warning 提示块标签
{% endnote %}

{% note danger flat %}
danger 提示块标签
{% endnote %}
<!-- endtab -->

<!-- tab disabled -->
```markdown
{% note disabled %}
默认 提示块标签
{% endnote %}

{% note default disabled %}
default 提示块标签
{% endnote %}

{% note primary disabled %}
primary 提示块标签
{% endnote %}

{% note success disabled %}
success 提示块标签
{% endnote %}

{% note info disabled %}
info 提示块标签
{% endnote %}

{% note warning disabled %}
warning 提示块标签
{% endnote %}

{% note danger disabled %}
danger 提示块标签
{% endnote %}
```
{% note disabled %}
默认 提示块标签
{% endnote %}

{% note default disabled %}
default 提示块标签
{% endnote %}

{% note primary disabled %}
primary 提示块标签
{% endnote %}

{% note success disabled %}
success 提示块标签
{% endnote %}

{% note info disabled %}
info 提示块标签
{% endnote %}

{% note warning disabled %}
warning 提示块标签
{% endnote %}

{% note danger disabled %}
danger 提示块标签
{% endnote %}
<!-- endtab -->

<!-- tab no-icon -->
```markdown
{% note no-icon %}
默认 提示块标签
{% endnote %}

{% note default no-icon %}
default 提示块标签
{% endnote %}

{% note primary no-icon %}
primary 提示块标签
{% endnote %}

{% note success no-icon %}
success 提示块标签
{% endnote %}

{% note info no-icon %}
info 提示块标签
{% endnote %}

{% note warning no-icon %}
warning 提示块标签
{% endnote %}

{% note danger no-icon %}
danger 提示块标签
{% endnote %}
```
{% note no-icon %}
默认 提示块标签
{% endnote %}

{% note default no-icon %}
default 提示块标签
{% endnote %}

{% note primary no-icon %}
primary 提示块标签
{% endnote %}

{% note success no-icon %}
success 提示块标签
{% endnote %}

{% note info no-icon %}
info 提示块标签
{% endnote %}

{% note warning no-icon %}
warning 提示块标签
{% endnote %}

{% note danger no-icon %}
danger 提示块标签
{% endnote %}
<!-- endtab -->
{% endtabs %}

### 自定义图标 Note
{% tabs %}
<!-- tab simple -->

```markdown
{% note 'fab fa-cc-visa' simple %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' simple %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' simple %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' simple%}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' simple %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' simple %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' simple %}
前端最讨厌的浏览器
{% endnote %}
```
{% note 'fab fa-cc-visa' simple %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' simple %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' simple %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' simple%}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' simple %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' simple %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' simple %}
前端最讨厌的浏览器
{% endnote %}
<!-- endtab -->

<!-- tab modern -->
```markdown
{% note 'fab fa-cc-visa' modern %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' modern %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' modern %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' modern%}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' modern %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' modern %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' modern %}
前端最讨厌的浏览器
{% endnote %}
```
{% note 'fab fa-cc-visa' modern %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' modern %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' modern %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' modern%}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' modern %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' modern %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' modern %}
前端最讨厌的浏览器
{% endnote %}
<!-- endtab -->

<!-- tab flat -->
```markdown
{% note 'fab fa-cc-visa' flat %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' flat %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' flat %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' flat%}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' flat %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' flat %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' flat %}
前端最讨厌的浏览器
{% endnote %}
```
{% note 'fab fa-cc-visa' flat %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' flat %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' flat %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' flat%}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' flat %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' flat %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' flat %}
前端最讨厌的浏览器
{% endnote %}
<!-- endtab -->

<!-- tab disabled -->
```markdown
{% note 'fab fa-cc-visa' disabled  %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' disabled  %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' disabled  %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' disabled %}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' disabled  %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' disabled  %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' disabled  %}
前端最讨厌的浏览器
{% endnote %}
```
{% note 'fab fa-cc-visa' disabled  %}
你是刷 Visa 还是是 UnionPay
{% endnote %}
{% note red 'fas fa-bullhorn' disabled  %}
2021年快到了....
{% endnote %}
{% note pink 'fas fa-car-crash' disabled  %}
小心开车 安全至上
{% endnote %}
{% note green 'fas fa-fan' disabled %}
这是三片呢？还是四片？
{% endnote %}
{% note orange 'fas fa-battery-half' disabled  %}
该充电了哦！
{% endnote %}
{% note purple 'far fa-hand-scissors' disabled  %}
剪刀石头布
{% endnote %}
{% note blue 'fab fa-internet-explorer' disabled  %}
前端最讨厌的浏览器
{% endnote %}
<!-- endtab -->

<!-- tab no-icon -->
```markdown
{% note no-icon %}
你是刷 Visa 还是 UnionPay
{% endnote %}
{% note blue no-icon %}
2021年快到了....
{% endnote %}
{% note pink no-icon %}
小心开车 安全至上
{% endnote %}
{% note red no-icon %}
这是三片呢？还是四片？
{% endnote %}
{% note orange no-icon %}
你是刷 Visa 还是 UnionPay
{% endnote %}
{% note purple no-icon %}
剪刀石头布
{% endnote %}
{% note green no-icon %}
前端最讨厌的浏览器
{% endnote %}
```
{% note no-icon %}
你是刷 Visa 还是 UnionPay
{% endnote %}
{% note blue no-icon %}
2021年快到了....
{% endnote %}
{% note pink no-icon %}
小心开车 安全至上
{% endnote %}
{% note red no-icon %}
这是三片呢？还是四片？
{% endnote %}
{% note orange no-icon %}
你是刷 Visa 还是 UnionPay
{% endnote %}
{% note purple no-icon %}
剪刀石头布
{% endnote %}
{% note green no-icon %}
前端最讨厌的浏览器
{% endnote %}
<!-- endtab -->
{% endtabs %}

### 上标标签
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% tip [参数，可选] %}文本内容{% endtip %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 样式：`success`、`error`、`warning`、`bolt`、`ban`、`home`、`sync`、`cogs`、`key`、`bell`
2. 自定义图标：支持 `fontawesome`。
<!-- endtab -->

<!-- tab 样式预览 -->
{% tip %}默认情况{% endtip %}
{% tip success %}success{% endtip %}
{% tip error %}error{% endtip %}
{% tip warning %}warning{% endtip %}
{% tip bolt %}bolt{% endtip %}
{% tip ban %}ban{% endtip %}
{% tip home %}home{% endtip %}
{% tip sync %}sync{% endtip %}
{% tip cogs %}cogs{% endtip %}
{% tip key %}key{% endtip %}
{% tip bell %}bell{% endtip %}
{% tip fa-atom %}自定义font awesome图标{% endtip %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% tip %}默认情况{% endtip %}
{% tip success %}success{% endtip %}
{% tip error %}error{% endtip %}
{% tip warning %}warning{% endtip %}
{% tip bolt %}bolt{% endtip %}
{% tip ban %}ban{% endtip %}
{% tip home %}home{% endtip %}
{% tip sync %}sync{% endtip %}
{% tip cogs %}cogs{% endtip %}
{% tip key %}key{% endtip %}
{% tip bell %}bell{% endtip %}
{% tip fa-atom %}自定义font awesome图标{% endtip %}
```
<!-- endtab -->

{% endtabs %}

### 动态标签
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% tip [参数，可选] %}文本内容{% endtip %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
更多详情请参看 `font-awesome-animation` 文档

1. 将所需的 `CSS` 类添加到图标（或 `DOM` 中的任何元素）。
2. 对于父级悬停样式，需要给目标元素添加指定 `CSS` 类，同时还要给目标元素的父级元素添加 `CSS` 类 `faa-parent` `animated-hover`。（详情见示例及示例源码）
3. 可以通过给目标元素添加 `CSS` 类 `faa-fast` 或 `faa-slow` 来控制动画快慢。
<!-- endtab -->

<!-- tab 样式预览 -->
1. On DOM load（当页面加载时显示动画）

  {% tip warning faa-horizontal animated %}warning{% endtip %}
  {% tip ban faa-flash animated %}ban{% endtip %}
2. 调整动画速度

  {% tip warning faa-horizontal animated faa-fast %}warning{% endtip %}
  {% tip ban faa-flash animated faa-slow %}ban{% endtip %}
3. On hover（当鼠标悬停时显示动画）

  {% tip warning faa-horizontal animated-hover %}warning{% endtip %}
  {% tip ban faa-flash animated-hover %}ban{% endtip %}
4. On parent hover（当鼠标悬停在父级元素时显示动画）

  {% tip warning faa-parent animated-hover %}<p class="faa-horizontal">warning</p>{% endtip %}
  {% tip ban faa-parent animated-hover %}<p class="faa-flash">ban</p>{% endtip %}
<!-- endtab -->

<!-- tab 示例源码 -->
1. On DOM load（当页面加载时显示动画）
```markdown
{% tip warning faa-horizontal animated %}warning{% endtip %}
{% tip ban faa-flash animated %}ban{% endtip %}
```
2. 调整动画速度
```markdown
{% tip warning faa-horizontal animated faa-fast %}warning{% endtip %}
{% tip ban faa-flash animated faa-slow %}ban{% endtip %}
```
3. On hover（当鼠标悬停时显示动画）
```markdown
{% tip warning faa-horizontal animated-hover %}warning{% endtip %}
{% tip ban faa-flash animated-hover %}ban{% endtip %}
```
4. On parent hover（当鼠标悬停在父级元素时显示动画）
```markdown
{% tip warning faa-parent animated-hover %}<p class="faa-horizontal">warning</p>{% endtip %}
{% tip ban faa-parent animated-hover %}<p class="faa-flash">ban</p>{% endtip %}
```
<!-- endtab -->

{% endtabs %}

### 复选列表
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% checkbox 样式参数（可选）, 文本（支持简单md） %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 样式: plus, minus, times
2. 颜色: red,yellow,green,cyan,blue,gray
3. 选中状态: checked
<!-- endtab -->

<!-- tab 样式预览 -->
{% checkbox 纯文本测试 %}
{% checkbox checked, 支持简单的 [markdown](https://guides.github.com/features/mastering-markdown/) 语法 %}
{% checkbox red, 支持自定义颜色 %}
{% checkbox green checked, 绿色 + 默认选中 %}
{% checkbox yellow checked, 黄色 + 默认选中 %}
{% checkbox cyan checked, 青色 + 默认选中 %}
{% checkbox blue checked, 蓝色 + 默认选中 %}
{% checkbox plus green checked, 增加 %}
{% checkbox minus yellow checked, 减少 %}
{% checkbox times red checked, 叉 %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% checkbox 纯文本测试 %}
{% checkbox checked, 支持简单的 [markdown](https://guides.github.com/features/mastering-markdown/) 语法 %}
{% checkbox red, 支持自定义颜色 %}
{% checkbox green checked, 绿色 + 默认选中 %}
{% checkbox yellow checked, 黄色 + 默认选中 %}
{% checkbox cyan checked, 青色 + 默认选中 %}
{% checkbox blue checked, 蓝色 + 默认选中 %}
{% checkbox plus green checked, 增加 %}
{% checkbox minus yellow checked, 减少 %}
{% checkbox times red checked, 叉 %}
```
<!-- endtab -->

{% endtabs %}

### 单选列表

{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% radio 样式参数（可选）, 文本（支持简单md） %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 颜色: red,yellow,green,cyan,blue,gray
2. 选中状态: checked
<!-- endtab -->

<!-- tab 样式预览 -->
{% radio 纯文本测试 %}
{% radio checked, 支持简单的 [markdown](https://guides.github.com/features/mastering-markdown/) 语法 %}
{% radio red, 支持自定义颜色 %}
{% radio green, 绿色 %}
{% radio yellow, 黄色 %}
{% radio cyan, 青色 %}
{% radio blue, 蓝色 %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% radio 纯文本测试 %}
{% radio checked, 支持简单的 [markdown](https://guides.github.com/features/mastering-markdown/) 语法 %}
{% radio red, 支持自定义颜色 %}
{% radio green, 绿色 %}
{% radio yellow, 黄色 %}
{% radio cyan, 青色 %}
{% radio blue, 蓝色 %}
```
<!-- endtab -->
{% endtabs %}

## 文本相关
### 行内文本样式 text
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% u 文本内容 %}
{% emp 文本内容 %}
{% wavy 文本内容 %}
{% del 文本内容 %}
{% kbd 文本内容 %}
{% psw 文本内容 %}
```
<!-- endtab -->

<!-- tab 样式预览 -->
1. 带 {% u 下划线 %} 的文本
2. 带 {% emp 着重号 %} 的文本
3. 带 {% wavy 波浪线 %} 的文本
4. 带 {% del 删除线 %} 的文本
5. 键盘样式的文本 {% kbd command %} + {% kbd D %}
6. 密码样式的文本：{% psw 这里没有验证码 %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
1. 带 {% u 下划线 %} 的文本
2. 带 {% emp 着重号 %} 的文本
3. 带 {% wavy 波浪线 %} 的文本
4. 带 {% del 删除线 %} 的文本
5. 键盘样式的文本 {% kbd command %} + {% kbd D %}
6. 密码样式的文本：{% psw 这里没有验证码 %}
```
<!-- endtab -->
{% endtabs %}
### 行内文本 span
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% span 样式参数(参数以空格划分), 文本内容 %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 字体: logo, code
2. 颜色: red,yellow,green,cyan,blue,gray
3. 大小: small, h4, h3, h2, h1, large, huge, ultra
4. 对齐方向: left, center, right
<!-- endtab -->

<!-- tab 样式预览 -->
- 彩色文字
在一段话中方便插入各种颜色的标签，包括：{% span red, 红色 %}、{% span yellow, 黄色 %}、{% span green, 绿色 %}、{% span cyan, 青色 %}、{% span blue, 蓝色 %}、{% span gray, 灰色 %}。
- 超大号文字
文档「开始」页面中的标题部分就是超大号文字。
{% span center logo large, Volantis %}
{% span center small, A Wonderful Theme for Hexo %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
- 彩色文字
在一段话中方便插入各种颜色的标签，包括：{% span red, 红色 %}、{% span yellow, 黄色 %}、{% span green, 绿色 %}、{% span cyan, 青色 %}、{% span blue, 蓝色 %}、{% span gray, 灰色 %}。
- 超大号文字
文档「开始」页面中的标题部分就是超大号文字。
{% span center logo large, Volantis %}
{% span center small, A Wonderful Theme for Hexo %}
```
<!-- endtab -->
{% endtabs %}
### 段落文本 p
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% p 样式参数(参数以空格划分), 文本内容 %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 字体: logo, code
2. 颜色: red,yellow,green,cyan,blue,gray
3. 大小: small, h4, h3, h2, h1, large, huge, ultra
4. 对齐方向: left, center, right
<!-- endtab -->

<!-- tab 样式预览 -->
- 彩色文字
在一段话中方便插入各种颜色的标签，包括：{% p red, 红色 %}、{% p yellow, 黄色 %}、{% p green, 绿色 %}、{% p cyan, 青色 %}、{% p blue, 蓝色 %}、{% p gray, 灰色 %}。
- 超大号文字
文档「开始」页面中的标题部分就是超大号文字。
{% p center logo large, Volantis %}
{% p center small, A Wonderful Theme for Hexo %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
- 彩色文字
在一段话中方便插入各种颜色的标签，包括：{% p red, 红色 %}、{% p yellow, 黄色 %}、{% p green, 绿色 %}、{% p cyan, 青色 %}、{% p blue, 蓝色 %}、{% p gray, 灰色 %}。
- 超大号文字
文档「开始」页面中的标题部分就是超大号文字。
{% p center logo large, Volantis %}
{% p center small, A Wonderful Theme for Hexo %}
```
<!-- endtab -->
{% endtabs %}

## 时间轴 timeline
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% timeline 时间线标题（可选）[,color] %}
<!-- timeline 时间节点（标题） -->
正文内容
<!-- endtimeline -->
<!-- timeline 时间节点（标题） -->
正文内容
<!-- endtimeline -->
{% endtimeline %}
```
<!-- endtab -->

<!-- tab 样式预览 -->
{% timeline 2020-07,blue %}
<!-- timeline 2020-07-24  -->
天气不错
<!-- endtimeline -->

<!-- timeline 2020-05-15 -->
学习
<!-- endtimeline -->
{% endtimeline %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% timeline 2020-07,blue %}
<!-- timeline 2020-07-24  -->
天气不错
<!-- endtimeline -->

<!-- timeline 2020-05-15 -->
学习
<!-- endtimeline -->
{% endtimeline %}
```
<!-- endtab -->
{% endtabs %}

## 链接卡片 link
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% link 标题, 链接, 图片链接（可选） %}
```
<!-- endtab -->

<!-- tab 样式预览 -->
{% link GitHub, https://github.com, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@450ea647ca67bd386416a689f3eb1bc6a508b3b9/2021/01/23/f7ac7b26db76ada1704f6af09bedacbe.webp %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% link GitHub, https://github.com, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@450ea647ca67bd386416a689f3eb1bc6a508b3b9/2021/01/23/f7ac7b26db76ada1704f6af09bedacbe.webp %}
```
<!-- endtab -->
{% endtabs %}

## 按钮 btns
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% btns 样式参数 %}
{% cell 标题, 链接, 图片或者图标 %}
{% cell 标题, 链接, 图片或者图标 %}
{% endbtns %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 圆角样式：rounded, circle
2. 增加文字样式：可以在容器内增加 <b>标题</b> 和 <p>描述文字</p>
3. 布局方式：默认为自动宽度，适合视野内只有一两个的情况。

| 参数 | 含义 |
| ---- | ----- |
| wide | 宽一点的按钮 |
| fill | 填充布局，自动铺满至少一行，多了会换行 |
| center | 居中，按钮之间是固定间距 |
| around | 居中分散 |
| grid2 | 等宽最多 2 列，屏幕变窄会适当减少列数 |
| grid3 | 等宽最多 3 列，屏幕变窄会适当减少列数 |
| grid4 | 等宽最多 4 列，屏幕变窄会适当减少列数 |
| grid5 | 等宽最多 5 列，屏幕变窄会适当减少列数 |
<!-- endtab -->

<!-- tab 样式预览 -->
1. 一组含有头像的链接

{% btns circle grid5 %}
{% cell GitHub, https://github.com/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@450ea647ca67bd386416a689f3eb1bc6a508b3b9/2021/01/23/f7ac7b26db76ada1704f6af09bedacbe.webp %}
{% cell 哔哩哔哩, https://www.bilibili.com/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@e642ee265c8ae2bbd0994716aa12b3adbe07f2c4/2021/01/23/2ceca69a212d3b9988bbd2c41edc636c.webp %}
{% cell Pixiv, https://www.pixiv.net/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@5c4fc20944c706aa452c31d1bddbdcc672e8c6ab/2021/01/23/7658d06315d32bcf0c954b3d8e8879e0.webp %}
{% cell YouTube, https://www.youtube.com/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@ff4781678ea6227f5824e3c8bfd5cc27441db4da/2021/01/23/f4e292c780275465c9150eb3cb0785a4.webp %}
{% cell 今日热榜, https://tophub.today/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@11fff6ed270722d709eb0ac88ce47f468c21d2ba/2021/01/23/cd22cd9d34d7d7bd58114d7d7a195822.webp %}
{% endbtns %}

2. 含有图标的按钮

{% btns rounded grid5 %}
{% cell 下载源码, /, fas fa-download %}
{% cell 查看文档, /, fas fa-book-open %}
{% endbtns %}

3. 圆形图标 + 标题 + 描述 + 图片 + 网格 5 列 + 居中

{% btns circle center grid5 %}
<a href='https://apps.apple.com/cn/app/heart-mate-pro-hrm-utility/id1463348922?ls=1'>
  <i class='fab fa-apple'></i>
  <b>心率管家</b>
  {% p red, 专业版 %}
  <img src='https://jsd.onmicrosoft.cn/gh/xaoxuu/cdn-assets/qrcode/heartmate_pro.png'>
</a>
<a href='https://apps.apple.com/cn/app/heart-mate-lite-hrm-utility/id1475747930?ls=1'>
  <i class='fab fa-apple'></i>
  <b>心率管家</b>
  {% p green, 免费版 %}
  <img src='https://jsd.onmicrosoft.cn/gh/xaoxuu/cdn-assets/qrcode/heartmate_lite.png'>
</a>
{% endbtns %}

<!-- endtab -->

<!-- tab 示例源码 -->
1. 一组含有头像的链接
```markdown
{% btns circle grid5 %}
{% cell GitHub, https://github.com/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@450ea647ca67bd386416a689f3eb1bc6a508b3b9/2021/01/23/f7ac7b26db76ada1704f6af09bedacbe.webp %}
{% cell 哔哩哔哩, https://www.bilibili.com/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@e642ee265c8ae2bbd0994716aa12b3adbe07f2c4/2021/01/23/2ceca69a212d3b9988bbd2c41edc636c.webp %}
{% cell Pixiv, https://www.pixiv.net/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@5c4fc20944c706aa452c31d1bddbdcc672e8c6ab/2021/01/23/7658d06315d32bcf0c954b3d8e8879e0.webp %}
{% cell YouTube, https://www.youtube.com/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@ff4781678ea6227f5824e3c8bfd5cc27441db4da/2021/01/23/f4e292c780275465c9150eb3cb0785a4.webp %}
{% cell 今日热榜, https://tophub.today/, https://jsd.onmicrosoft.cn/gh/cpddo/p_img@11fff6ed270722d709eb0ac88ce47f468c21d2ba/2021/01/23/cd22cd9d34d7d7bd58114d7d7a195822.webp %}
{% endbtns %}
```
2. 含有图标的按钮
```markdown
{% btns rounded grid5 %}
{% cell 下载源码, /, fas fa-download %}
{% cell 查看文档, /, fas fa-book-open %}
{% endbtns %}
```
3. 圆形图标 + 标题 + 描述 + 图片 + 网格 5 列 + 居中
```markdown
{% btns circle center grid5 %}
<a href='https://apps.apple.com/cn/app/heart-mate-pro-hrm-utility/id1463348922?ls=1'>
  <i class='fab fa-apple'></i>
  <b>心率管家</b>
  {% p red, 专业版 %}
  <img src='https://jsd.onmicrosoft.cn/gh/xaoxuu/cdn-assets/qrcode/heartmate_pro.png'>
</a>
<a href='https://apps.apple.com/cn/app/heart-mate-lite-hrm-utility/id1475747930?ls=1'>
  <i class='fab fa-apple'></i>
  <b>心率管家</b>
  {% p green, 免费版 %}
  <img src='https://jsd.onmicrosoft.cn/gh/xaoxuu/cdn-assets/qrcode/heartmate_lite.png'>
</a>
{% endbtns %}
```
<!-- endtab -->
{% endtabs %}

## Github 卡片 ghcard
{% note info flat %}
info `ghcard` 使用了 `github-readme-stats` 的 `API`，支持直接使用 `markdown` 语法来写。
{% endnote %}

{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% ghcard 用户名, 其它参数（可选） %}
{% ghcard 用户名/仓库, 其它参数（可选） %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
更多参数参考：
{% ghcard anuraghazra/github-readme-stats, theme=onedark %}
使用 `,` 分割各个参数。写法为：`参数名=参数值`
以下只写几个常用参数值

| 参数名 | 取值 | 释义 |
|-------|------|------|
|hide	|stars,commits,prs,issues,contribs|	隐藏指定统计|
|count_private|	true|	将私人项目贡献添加到总提交计数中|
|show_icons|	true	|显示图标|
|theme	|请查阅 `Available Themes`	|主题|

<!-- endtab -->

<!-- tab 样式预览 -->
1. 用户信息卡片

| {% ghcard jerryc127 %}               | {% ghcard Zfour, theme=vue %}              |
| ------------------------------------ | ------------------------------------------ |
| {% ghcard Akilarlxh, theme=buefy %}  | {% ghcard ruanyf, theme=solarized-light %} |
| {% ghcard philwebb, theme=onedark %} | {% ghcard zjwo, theme=solarized-dark %}    |
| {% ghcard vpavic, theme=algolia %}   | {% ghcard bclozel, theme=calm %}           |

2. 仓库信息卡片

| {% ghcard spring-projects/spring-boot %}                 | {% ghcard mybatis/mybatis-3, theme=vue %}               |
| -------------------------------------------------------- | ------------------------------------------------------- |
| {% ghcard jerryc127/hexo-theme-butterfly, theme=buefy %} | {% ghcard alibaba/fastjson, theme=solarized-light %}    |
| {% ghcard alibaba/druid, theme=onedark %}                | {% ghcard alibaba/arthas, theme=solarized-dark %}       |
| {% ghcard Tencent/weui, theme=algolia %}                 | {% ghcard volantis-x/hexo-theme-volantis, theme=calm %} |

<!-- endtab -->

<!-- tab 示例源码 -->
1. 用户信息卡片
```markdown
| {% ghcard jerryc127 %}               | {% ghcard Zfour, theme=vue %}              |
| ------------------------------------ | ------------------------------------------ |
| {% ghcard Akilarlxh, theme=buefy %}  | {% ghcard ruanyf, theme=solarized-light %} |
| {% ghcard philwebb, theme=onedark %} | {% ghcard zjwo, theme=solarized-dark %}    |
| {% ghcard vpavic, theme=algolia %}   | {% ghcard bclozel, theme=calm %}           |
```
2. 仓库信息卡片
```markdown
| {% ghcard spring-projects/spring-boot %}                 | {% ghcard mybatis/mybatis-3, theme=vue %}               |
| -------------------------------------------------------- | ------------------------------------------------------- |
| {% ghcard jerryc127/hexo-theme-butterfly, theme=buefy %} | {% ghcard alibaba/fastjson, theme=solarized-light %}    |
| {% ghcard alibaba/druid, theme=onedark %}                | {% ghcard alibaba/arthas, theme=solarized-dark %}       |
| {% ghcard Tencent/weui, theme=algolia %}                 | {% ghcard volantis-x/hexo-theme-volantis, theme=calm %} |
```
<!-- endtab -->
{% endtabs %}

## Github 徽标 ghbdage
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% bdage [right],[left],[logo]||[color],[link],[title]||[option] %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
本外挂标签的参数分为三组，用 `||` 分割。
1. left：徽标左边的信息，必选参数。
2. right: 徽标右边的信息，必选参数，
3. logo：徽标图标，图标名称详见 simpleicons，可选参数。
4. color：徽标右边的颜色，可选参数。
5. link：指向的链接，可选参数。
6. title：徽标的额外信息，可选参数。主要用于优化 SEO，但 object 标签不会像 a 标签一样在鼠标悬停显示 title 信息。
7. option：自定义参数，支持 shields.io 的全部 API 参数支持，具体参数可以参看上文中的拓展写法示例。形式为 name1=value2&name2=value2。
<!-- endtab -->

<!-- tab 样式预览 -->
基本参数，定义徽标左右文字和图标

{% bdage Theme,Butterfly %}
{% bdage Frame,Hexo,hexo %}

信息参数，定义徽标右侧内容背景色，指向链接

{% bdage CDN,JsDelivr,jsDelivr||abcdef,https://metroui.org.ua/index.html,本站使用JsDelivr为静态资源提供CDN加速 %}
// 如果是跨顺序省略可选参数，仍然需要写个逗号,用作分割
{% bdage Source,GitHub,GitHub||,https://github.com/ %}

拓展参数，支持 shields 的 API 的全部参数内容

{% bdage Hosted,Vercel,Vercel||brightgreen,https://vercel.com/,本站采用双线部署，默认线路托管于Vercel||style=social&logoWidth=20 %}
// 如果是跨顺序省略可选参数组，仍然需要写双竖线||用作分割
{% bdage Hosted,Vercel,Vercel||||style=social&logoWidth=20&logoColor=violet %}

<!-- endtab -->

<!-- tab 示例源码 -->
基本参数，定义徽标左右文字和图标
```markdown
{% bdage Theme,Butterfly %}
{% bdage Frame,Hexo,hexo %}
```
信息参数，定义徽标右侧内容背景色，指向链接
```markdown
{% bdage CDN,JsDelivr,jsDelivr||abcdef,https://metroui.org.ua/index.html,本站使用JsDelivr为静态资源提供CDN加速 %}
// 如果是跨顺序省略可选参数，仍然需要写个逗号,用作分割
{% bdage Source,GitHub,GitHub||,https://github.com/ %}
```
拓展参数，支持 shields 的 API 的全部参数内容
```markdown
{% bdage Hosted,Vercel,Vercel||brightgreen,https://vercel.com/,本站采用双线部署，默认线路托管于Vercel||style=social&logoWidth=20 %}
// 如果是跨顺序省略可选参数组，仍然需要写双竖线||用作分割
{% bdage Hosted,Vercel,Vercel||||style=social&logoWidth=20&logoColor=violet %}
```
<!-- endtab -->
{% endtabs %}

## 行内图片 inlineimage
这是 {% inlineimage https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-emoji/aru-l/0000.gif %} 一段话。

这又是 {% inlineimage https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-emoji/aru-l/5150.gif, height=40px %} 一段话。
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% inlineimage 图片链接, height=高度（可选） %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
高度：height=20px
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
这是 {% inlineimage https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-emoji/aru-l/0000.gif %} 一段话。

这又是 {% inlineimage https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-emoji/aru-l/5150.gif, height=40px %} 一段话。
<!-- endtab -->

<!-- tab Butterfly内置 -->
你看我长得漂亮不

我觉得很漂亮 {% inlineImg https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-emoji/aru-l/0000.gif 80px %}
**语法：**
```markdown
{% inlineImg [src] [height] %}

[src]      :    图片链接
[height]   ：   图片高度限制【可选】
```
**示例源码：**
```markdown
你看我长得漂亮不

我觉得很漂亮 {% inlineImg https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-emoji/aru-l/0000.gif 80px %}
```
<!-- endtab -->
{% endtabs %}

## 单张图片 image
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% image 链接, width=宽度（可选）, height=高度（可选）, alt=描述（可选）, bg=占位颜色（可选） %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 图片宽度高度：width=300px, height=32px

2. 图片描述：alt = 图片描述（butterfly 需要在主题配置文件中开启图片描述）

3. 占位背景色：bg=#f2f2f2

<!-- endtab -->

<!-- tab 样式预览 -->
1. 添加描述

{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, alt=每天下课回宿舍的路，没有什么故事。 %}

2. 指定宽度

{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, width=400px %}

3. 指定宽度并添加描述：

{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, width=400px, alt=每天下课回宿舍的路，没有什么故事。 %}

4. 设置占位背景色：

{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, width=400px, bg=#1D0C04, alt=优化不同宽度浏览的观感 %}

<!-- endtab -->

<!-- tab 示例源码 -->
1. 添加描述
```markdown
{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, alt=每天下课回宿舍的路，没有什么故事。 %}
```
2. 指定宽度
```markdown
{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, width=400px %}
```
3. 指定宽度并添加描述：
```markdown
{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, width=400px, alt=每天下课回宿舍的路，没有什么故事。 %}
```
4. 设置占位背景色：
```markdown
{% image https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper-minimalist/2020/025.jpg, width=400px, bg=#1D0C04, alt=优化不同宽度浏览的观感 %}
```
<!-- endtab -->
{% endtabs %}

## 音频 audio
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% audio 音频链接 %}
```
<!-- endtab -->

<!-- tab 样式预览 -->
{% audio https://音乐链接.mp3 %}
{% audio https://音乐链接.mp3 %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% audio https://音乐链接.mp3 %}
{% audio https://音乐链接.mp3 %}
```
<!-- endtab -->
{% endtabs %}

## 视频 video
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% video 视频链接 %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 对其方向：left, center, right
2. 列数：逗号后面直接写列数，支持 1 ～ 4 列。
<!-- endtab -->

<!-- tab 样式预览 -->
1. 100% 宽度

{% video 视频链接 %}

2. 50% 宽度

{% videos, 2 %}
{% video 视频链接 %}
{% video 视频链接 %}
{% video 视频链接 %}
{% video 视频链接 %}
{% endvideos %}

3. 25% 宽度

{% videos, 4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% endvideos %}

<!-- endtab -->

<!-- tab 示例源码 -->
1. 100% 宽度
```markdown
{% video 视频链接 %}
```
2. 50% 宽度
```markdown
{% videos, 2 %}
{% video 视频链接 %}
{% video 视频链接 %}
{% video 视频链接 %}
{% video 视频链接 %}
{% endvideos %}
```
3. 25% 宽度
```markdown
{% videos, 4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% video https://www.w3school.com.cn/example/html5/mov_bbb.mp4 %}
{% endvideos %}
```
<!-- endtab -->
{% endtabs %}

## 相册 gallery
{% note primary flat %}
以下为 Butterfly 自带的 gallery 标签写法。相册图库和相册配合使用。
{% endnote %}
{% tabs %}
<!-- tab 标签语法 -->

1. gallerygroup 相册图库
```markdown
<div class="gallery-group-main">
{% galleryGroup name description link img-url %}
{% galleryGroup name description link img-url %}
{% galleryGroup name description link img-url %}
</div>
```
2. gallery 相册
```markdown
{% gallery %}
markdown 图片格式
{% endgallery %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
- gallerygroup 相册图库

| 参数名      | 释义                 |
| :---------- | :------------------- |
| name        | 图库名字             |
| description | 图库描述             |
| link        | 链接到对应相册的地址 |
| img-url     | 图库封面             |

{% note success modern %}
思维拓展一下，相册图库的实质其实就是个快捷方式，可以自定义添加描述、封面、链接。那么我们未必要把它当做一个相册，完全可以作为一个链接卡片，链接到视频、QQ、友链都是不错的选择。
{% endnote %}
- gallery 相册
区别于旧版的 Gallery 相册，新的 Gallery 相册会自动根据图片长度进行排版，书写也更加方便，与 markdown 格式一样。可根据需要插入到相应的 md。无需再自己配置长宽。建议在粘贴时故意使用长短、大小、横竖不一的图片，会有更好的效果。（尺寸完全相同的图片只会平铺输出，效果很糟糕）
<!-- endtab -->

<!-- tab 样式预览 -->
1. gallerygroup 相册图库

<div class="gallery-group-main">
{% galleryGroup '壁纸' '源于网络，侵删！' '/photos/wallpaper/' https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper/abstract/41F215B9-261F-48B4-80B5-4E86E165259E.jpeg %}
</div>

2. gallery 相册

{% gallery %}
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/10.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/9.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/8.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/7.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/6.jpg)
{% endgallery %}

<!-- endtab -->

<!-- tab 示例源码 -->
1. gallerygroup 相册图库
```markdown
<div class="gallery-group-main">
{% galleryGroup '壁纸' '源于网络，侵删！' '/photos/wallpaper/' https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper/abstract/41F215B9-261F-48B4-80B5-4E86E165259E.jpeg %}
</div>
```
2. gallery 相册
```markdown
{% gallery %}
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/10.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/9.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/8.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/7.jpg)
![images](https://npm.elemecdn.com/cover_img/wallpaper/work/6.jpg)
{% endgallery %}
```
<!-- endtab -->
{% endtabs %}

## 折叠框 folding
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% folding 参数（可选）, 标题 %}
哈哈哈哈
{% endfolding %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. 颜色：blue, cyan, green, yellow, red
2. 状态：状态填写 open 代表默认打开。
<!-- endtab -->

<!-- tab 样式预览 -->
{% folding 查看图片测试 %}
![images](https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper/abstract/41F215B9-261F-48B4-80B5-4E86E165259E.jpeg)
{% endfolding %}

{% folding cyan open, 查看默认打开的折叠框 %}
这是一个默认打开的折叠框。
{% endfolding %}

{% folding green, 查看代码测试 %}
```python
print("hello, world")
```
{% endfolding %}

{% folding yellow, 查看列表测试 %}
- haha
- hehe
{% endfolding %}

{% folding red, 查看嵌套测试 %}
{% folding blue, 查看嵌套测试2 %}
{% folding 查看嵌套测试3 %}
hahaha😜
{% endfolding %}
{% endfolding %}
{% endfolding %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% folding 查看图片测试 %}
![images](https://jsd.onmicrosoft.cn/gh/volantis-x/cdn-wallpaper/abstract/41F215B9-261F-48B4-80B5-4E86E165259E.jpeg)
{% endfolding %}

{% folding cyan open, 查看默认打开的折叠框 %}
这是一个默认打开的折叠框。
{% endfolding %}

{% folding green, 查看代码测试 %}
​```python
print("hello, world")
​```
{% endfolding %}

{% folding yellow, 查看列表测试 %}
- haha
- hehe
{% endfolding %}

{% folding red, 查看嵌套测试 %}
{% folding blue, 查看嵌套测试2 %}
{% folding 查看嵌套测试3 %}
hahaha😜
{% endfolding %}
{% endfolding %}
{% endfolding %}
```
<!-- endtab -->

<!-- tab Butterfly内置 -->
语法：
( display 不能包含英文逗号，可用 &sbquo; )
```markdown
{% hideToggle display,bg,color %}
content
{% endhideToggle %}
```
示例源码：
```markdown
{% hideToggle Butterfly 安装方法 %}
在你的博客根目录里

​```sh
git clone -b master https://github.com/jerryc127/hexo-theme-butterfly.git themes/Butterfly
​```

如果想要安装比较新的 dev 分支，可以

​```sh
git clone -b dev https://github.com/jerryc127/hexo-theme-butterfly.git themes/Butterfly{% endhideToggle %}
​```

{% endhideToggle %}
```
<!-- endtab -->

{% endtabs %}

## 分栏
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% tabs Unique name, [index] %}
<!-- tab [Tab caption] [@icon] -->
Any content (support inline tags too).
<!-- endtab -->
{% endtabs %}
```
<!-- endtab -->

<!-- tab 配置参数 -->

1. Unique name :
   - 选项卡块标签的唯一名称，不带逗号。
   - 将在 #id 中用作每个标签及其索引号的前缀。
   - 如果名称中包含空格，则对于生成 #id，所有空格将由破折号代替。
   - 仅当前帖子 / 页面的 URL 必须是唯一的！
2. [index]:
   - 活动选项卡的索引号。
   - 如果未指定，将选择第一个标签（1）。
   - 如果 index 为 - 1，则不会选择任何选项卡。
   - 可选参数。
3. [Tab caption]:
   - 当前选项卡的标题。
   - 如果未指定标题，则带有制表符索引后缀的唯一名称将用作制表符的标题。
   - 如果未指定标题，但指定了图标，则标题将为空。
   - 可选参数。
4. [@icon]:
   - FontAwesome 图标名称（全名，看起来像 “fas fa-font”）
   - 可以指定带空格或不带空格；
   - 例如’Tab caption @icon’ 和 ‘Tab caption@icon’.
   - 可选参数。

<!-- endtab -->

<!-- tab 样式预览 -->
{% note primary flat %}
Demo 1 - 预设选择第一个【默认】
{% endnote %}

{% tabs test1 %}
<!-- tab -->
**This is Tab 1.**
<!-- endtab -->

<!-- tab -->
**This is Tab 2.**
<!-- endtab -->

<!-- tab -->
**This is Tab 3.**
<!-- endtab -->
{% endtabs %}


{% note primary flat %}
Demo 2 - 预设选择 tabs
{% endnote %}

{% tabs test2, 3 %}
<!-- tab -->
**This is Tab 1.**
<!-- endtab -->

<!-- tab -->
**This is Tab 2.**
<!-- endtab -->

<!-- tab -->
**This is Tab 3.**
<!-- endtab -->
{% endtabs %}

{% note primary flat %}
Demo 3 - 没有预设值
{% endnote %}

{% tabs test3, -1 %}
<!-- tab -->
**This is Tab 1.**
<!-- endtab -->

<!-- tab -->
**This is Tab 2.**
<!-- endtab -->

<!-- tab -->
**This is Tab 3.**
<!-- endtab -->
{% endtabs %}


{% note primary flat %}
Demo 4 - 自定义 Tab 名 + 只有 icon + icon 和 Tab 名
{% endnote %}

{% tabs test4 %}
<!-- tab 第一个Tab -->
**tab名字为第一个Tab**
<!-- endtab -->

<!-- tab @fab fa-apple-pay -->
**只有图标 没有Tab名字**
<!-- endtab -->

<!-- tab 炸弹@fas fa-bomb -->
**名字+icon**
<!-- endtab -->
{% endtabs %}

<!-- endtab -->

<!-- tab 示例源码 -->
{% note primary flat %}
Demo 1 - 预设选择第一个【默认】
{% endnote %}
```markdown
{% tabs test1 %}
<!-- tab -->
**This is Tab 1.**
<!-- endtab -->

<!-- tab -->
**This is Tab 2.**
<!-- endtab -->

<!-- tab -->
**This is Tab 3.**
<!-- endtab -->
{% endtabs %}
```

{% note primary flat %}
Demo 2 - 预设选择 tabs
{% endnote %}
```markdown
{% tabs test2, 3 %}
<!-- tab -->
**This is Tab 1.**
<!-- endtab -->

<!-- tab -->
**This is Tab 2.**
<!-- endtab -->

<!-- tab -->
**This is Tab 3.**
<!-- endtab -->
{% endtabs %}
```
{% note primary flat %}
Demo 3 - 没有预设值
{% endnote %}
```markdown
{% tabs test3, -1 %}
<!-- tab -->
**This is Tab 1.**
<!-- endtab -->

<!-- tab -->
**This is Tab 2.**
<!-- endtab -->

<!-- tab -->
**This is Tab 3.**
<!-- endtab -->
{% endtabs %}
```

{% note primary flat %}
Demo 4 - 自定义 Tab 名 + 只有 icon + icon 和 Tab 名
{% endnote %}
```markdown
{% tabs test4 %}
<!-- tab 第一个Tab -->
**tab名字为第一个Tab**
<!-- endtab -->

<!-- tab @fab fa-apple-pay -->
**只有图标 没有Tab名字**
<!-- endtab -->

<!-- tab 炸弹@fas fa-bomb -->
**名字+icon**
<!-- endtab -->
{% endtabs %}
```
<!-- endtab -->
{% endtabs %}

## 诗词标签 poem
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% poem [title],[author] %}
诗词内容
{% endpoem %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
1. title：诗词标题
2. author：作者，可以不写
<!-- endtab -->

<!-- tab 样式预览 -->
{% poem 水调歌头,苏轼 %}
丙辰中秋，欢饮达旦，大醉，作此篇，兼怀子由。
明月几时有？把酒问青天。
不知天上宫阙，今夕是何年？
我欲乘风归去，又恐琼楼玉宇，高处不胜寒。
起舞弄清影，何似在人间？

转朱阁，低绮户，照无眠。
不应有恨，何事长向别时圆？
人有悲欢离合，月有阴晴圆缺，此事古难全。
但愿人长久，千里共婵娟。
{% endpoem %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% poem 水调歌头,苏轼 %}
丙辰中秋，欢饮达旦，大醉，作此篇，兼怀子由。
明月几时有？把酒问青天。
不知天上宫阙，今夕是何年？
我欲乘风归去，又恐琼楼玉宇，高处不胜寒。
起舞弄清影，何似在人间？

转朱阁，低绮户，照无眠。
不应有恨，何事长向别时圆？
人有悲欢离合，月有阴晴圆缺，此事古难全。
但愿人长久，千里共婵娟。
{% endpoem %}
```
<!-- endtab -->
{% endtabs %}

## label
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% label text color %}
```
<!-- endtab -->

<!-- tab 配置参数 -->

| 参数  |                             解释                             |
| :---: | :----------------------------------------------------------: |
| text  |                             文字                             |
| color | 【可选】背景颜色，默认为 `default` default / blue / pink / red / purple / orange / green |

<!-- endtab -->

<!-- tab 样式预览 -->
臣亮言：{% label 先帝 %}创业未半，而{% label 中道崩殂 blue %}。今天下三分，{% label 益州疲敝 pink %}，此诚{% label 危急存亡之秋 red %}也！然侍衞之臣，不懈于内；{% label 忠志之士 purple %}，忘身于外者，盖追先帝之殊遇，欲报之于陛下也。诚宜开张圣听，以光先帝遗德，恢弘志士之气；不宜妄自菲薄，引喻失义，以塞忠谏之路也。
宫中、府中，俱为一体；陟罚臧否，不宜异同。若有{% label 作奸 orange %}、{% label 犯科 green %}，及为忠善者，宜付有司，论其刑赏，以昭陛下平明之治；不宜偏私，使内外异法也。
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
臣亮言：{% label 先帝 %}创业未半，而{% label 中道崩殂 blue %}。今天下三分，{% label 益州疲敝 pink %}，此诚{% label 危急存亡之秋 red %}也！然侍衞之臣，不懈于内；{% label 忠志之士 purple %}，忘身于外者，盖追先帝之殊遇，欲报之于陛下也。诚宜开张圣听，以光先帝遗德，恢弘志士之气；不宜妄自菲薄，引喻失义，以塞忠谏之路也。
宫中、府中，俱为一体；陟罚臧否，不宜异同。若有{% label 作奸 orange %}、{% label 犯科 green %}，及为忠善者，宜付有司，论其刑赏，以昭陛下平明之治；不宜偏私，使内外异法也。
```
<!-- endtab -->
{% endtabs %}

## 进度条
{% tabs %}
<!-- tab 标签语法 -->
```markdown
{% progress [width] [color] [text] %}
```
<!-- endtab -->

<!-- tab 配置参数 -->
- width：0 到 100 的阿拉伯数字
- color：颜色，取值有 red、yellow、green、cyan、blue、gray
- text：进度条上的文字内容
<!-- endtab -->

<!-- tab 样式预览 -->
{% progress 10 red 进度条样式预览 %}
{% progress 30 yellow 进度条样式预览 %}
{% progress 50 green 进度条样式预览 %}
{% progress 70 cyan 进度条样式预览 %}
{% progress 90 blue 进度条样式预览 %}
{% progress 100 gray 进度条样式预览 %}
<!-- endtab -->

<!-- tab 示例源码 -->
```markdown
{% progress 10 red 进度条样式预览 %}
{% progress 30 yellow 进度条样式预览 %}
{% progress 50 green 进度条样式预览 %}
{% progress 70 cyan 进度条样式预览 %}
{% progress 90 blue 进度条样式预览 %}
{% progress 100 gray 进度条样式预览 %}
```
<!-- endtab -->
{% endtabs %}

## 参考
- [小嘉的部落格](https://blog.imzjw.cn/posts/bfdocs)
- [akilar博客](https://akilar.top/posts/615e2dec/)