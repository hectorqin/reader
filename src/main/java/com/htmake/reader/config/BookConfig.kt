package com.htmake.reader.config

import java.io.File

object BookConfig {
    val javascriptVersion = "reader-inject-javascript-1.1.0"
    val epubInjectJavascript = """
    //<![CDATA[
    // ${javascriptVersion}
    if (!window.reader_inited) {
        function reader_notify(event, data, id) {
            if (window.self !== window.top) {
                window.top.postMessage(JSON.stringify({
                    id: id,
                    event: event,
                    data: data
                }), '*');
            }
        }

        var reader_style_dom = document.createElement('style');
        var head = document.head || document.getElementsByTagName('head')[0];
        head.appendChild(reader_style_dom);

        function reader_setStyle(style) {
            reader_style_dom.innerText = style;
            reader_notifyHeight();
            setTimeout(reader_notifyHeight, 100);
        }

        function reader_notifyHeight() {
            reader_notify("setHeight", document.documentElement.scrollHeight || document.body.scrollHeight)
        }

        function reader_listenFromParent(event) {
            reader_notify('received', {
                data: event.data
            })
            let data;
            try {
                data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            } catch (error) {
                // console.error(error);
                return;
            }

            if (!data) {
                return;
            }
            reader_notify("data ", data);
            if (data.event === 'setStyle') {
                reader_setStyle(data.style);
            } else if (data.event === 'execute') {
                eval(data.script);
            } else if (data.id) {
                if (window.nativeCallback[data.id]) {
                    window.nativeCallback[data.id](data);
                    delete window.nativeCallback[data.id]
                }
            }
        }


        function reader_getLinkElement(element) {
            if (!element || !element.nodeName) {
                return false;
            }
            if (element.nodeName.toLowerCase() === "a") {
                return element;
            }
            return reader_getLinkElement(element.parentNode)
        }

        function reader_getImageElement(element) {
            if (!element || !element.nodeName) {
                return false;
            }
            if (element.nodeName.toLowerCase() === "img") {
                return element;
            }
        }

        window.document.addEventListener('message', reader_listenFromParent);
        window.addEventListener('message', reader_listenFromParent);
        window.addEventListener('load', function() {
            reader_notifyHeight();
            reader_notify("load", window.location.href);
        });
        window.addEventListener('resize', reader_notifyHeight);
        document.addEventListener('DOMNodeInserted', reader_notifyHeight, false);
        document.addEventListener('click', function(event) {
            var linkElement = reader_getLinkElement(event.target)
            var imageElement = reader_getImageElement(event.target)
            if (linkElement) {
                // 点击链接跳转
                if (linkElement.pathname === window.location.pathname) {
                    // 页内跳转
                    var hashElement = document.querySelector(linkElement.hash)
                    if (hashElement) {
                        reader_notify("clickHash", hashElement.getBoundingClientRect())
                    }
                } else {
                    // 跳转其他页面
                    reader_notify("clickA", event.target.href);
                }
            } else if (imageElement) {
                var imgList = document.querySelectorAll("img");
                if (imgList.length) {
                    var imgUrlList = [];
                    var index = 0;
                    for (let i = 0; i < imgList.length; i++) {
                        imgUrlList.push(imgList[i].src);
                        if (imgList[i] === imageElement) {
                            index = i;
                        }
                    }
                    reader_notify("previewImageList", {
                        imageList: imgUrlList,
                        imageIndex: index
                    });
                }
            } else {
                reader_notify("click", {
                    target: event.target.nodeName,
                    clientX: event.clientX,
                    clientY: event.clientY
                });
            }
        });
        window.addEventListener("keydown", function(event) {
            event.preventDefault();
            event.stopPropagation();
            reader_notify("keydown", {
                key: event.key,
                keyCode: event.keyCode
            });
        });
        reader_notify("inited");

        window.reader_inited = true;
    }
    //]]>
    """

    fun injectJavascriptToEpubChapter(filePath: String) {
        val file = File(filePath);
        if (file.exists()) {
            var content = file.readText()
            if (content.indexOf(javascriptVersion) < 0) {
                content = content.replace("<head>", """<head><script type="text/javascript">${epubInjectJavascript}</script>""")
                file.writeText(content)
            }
        }
    }
}