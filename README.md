# daodao

一个面向 GitHub Pages 的静态日记单页。

## 文件

- `index.html`：页面入口。
- `style.css`：最大宽度 1280px 的横块式响应式排版。
- `app.js`：读取并解析日记文本。
- `assets/hero.jpg`：顶部图片。
- `daodao.txt`：原始日记文本，每篇以独占一行的 `YYYYMMDD` 开头。
- `robots.txt`：请求搜索引擎不要抓取或索引。
- `.nojekyll`：让 GitHub Pages 直接发布静态文件。

## 隐私边界

`robots.txt` 和页面里的 `noindex` 只对守规矩的搜索引擎起劝阻作用，不是访问控制。部署到 GitHub Pages 后，知道地址的人仍然可以访问页面和 `daodao.txt`。

## 本地预览

由于浏览器通常不允许直接从本地文件读取 `daodao.txt`，请在目录内启动一个静态服务器后访问页面：

```sh
python3 -m http.server 8000
```

然后打开：

```text
http://localhost:8000/
```

## GitHub Pages

仓库名使用 `daodao` 时，GitHub Pages 的默认项目地址会是：

```text
https://yourname.github.io/daodao/
```
