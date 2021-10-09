package org.lightink.reader.config

import java.io.File

object BookConfig {
    val epubInjectJavascript = """
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

    window.document.addEventListener('message', reader_listenFromParent);
    window.addEventListener('message', reader_listenFromParent);
    window.addEventListener('load', function() {
        reader_notifyHeight();
        reader_notify("load");
    });
    window.addEventListener('resize', reader_notifyHeight);
    document.addEventListener('DOMNodeInserted', reader_notifyHeight, false);
    reader_notify("inited");
    """

    fun injectJavascriptToEpubChapter(filePath: String) {
        val file = File(filePath);
        if (file.exists()) {
            var content = file.readText()
            if (content.indexOf("reader_listenFromParent") < 0) {
                content = content.replace("</head>", "<script>${epubInjectJavascript}</script></head>")
                file.writeText(content)
            }
        }
    }
}