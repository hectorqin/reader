package org.lightink.reader.parser

import org.jsoup.Jsoup

/**
 * @Auther: zoharSoul
 * @Date: 2019-07-19 17:47
 * @Description:
 */
class TestParser {
}

fun main(args: Array<String>) {
    val s = " \n" +
            "\n" +
            "<!DOCTYPE html>\n" +
            "<html lang=\"zh-CN\">\n" +
            "    <head>\n" +
            "        <meta charset=\"utf-8\">\n" +
            "        <meta http-equiv=\"X-UA-Compatible\" content=\"IE=edge\">\n" +
            "        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
            "        <title>搜索：啊 结果记录_稻草人书屋</title>\n" +
            "        <meta name=\"keywords\" content=\"啊，稻草人书屋\"/>\n" +
            "        <meta name=\"description\" content=\"搜索啊的结果\"/>\n" +
            "        <link href=\"//www.daocaorenshuwu.com/static/css/bootstrap.min.css\" rel=\"stylesheet\">\n" +
            "        <link href=\"//www.daocaorenshuwu.com/static/css/font-awesome.min.css\" rel=\"stylesheet\">\n" +
            "        <link href=\"//www.daocaorenshuwu.com/static/css/base.css\" rel=\"stylesheet\">\n" +
            "        <!--[if lt IE 9]>\n" +
            "        <script src=\"//www.daocaorenshuwu.com/static/js/html5shiv.min.js\"></script>\n" +
            "        <script src=\"//www.daocaorenshuwu.com/static/js/respond.min.js\"></script>\n" +
            "        <![endif]-->\n" +
            "        <script src=\"//www.daocaorenshuwu.com/static/js/jquery.min.js\"></script>\n" +
            "        <script src=\"//www.daocaorenshuwu.com/static/js/bootstrap.min.js\"></script>\n" +
            "        <script src=\"//www.daocaorenshuwu.com/static/js/jquery.cookie.js\"></script>\n" +
            "        <script src=\"//www.daocaorenshuwu.com/static/js/base.js\"></script>\n" +
            "    </head>\n" +
            "    <body>\n" +
            "        <script>DaoCaoRen.getCode('topbar');</script>\n" +
            "        <!-- Header Begin -->\n" +
            "        <div class=\"header\">\n" +
            "            <div class=\"container\">\n" +
            "                <div class=\"logo fl\">\n" +
            "                    <h2>\n" +
            "                        <a href=\"//www.daocaorenshuwu.com\">稻草人书屋</a>\n" +
            "                    </h2>\n" +
            "                </div>\n" +
            "                <div class=\"fr visible-xs\">\n" +
            "                    <a href=\"/user.php\">\n" +
            "                        <span class=\"fa fa-user-o userico\" aria-hidden=\"true\"></span>\n" +
            "                    </a>\n" +
            "                </div>\n" +
            "                <script>DaoCaoRen.getCode('topui');</script>\n" +
            "            </div>\n" +
            "        </div>\n" +
            "        <!-- Header End -->\n" +
            "        <!-- Nav Begin -->\n" +
            "        <div class=\"small-nav visible-xs\">\n" +
            "            <div class=\"container\">\n" +
            "                <a href=\"/book.html\">图书</a>\n" +
            "                <a href=\"/xiazai.html\">下载</a>\n" +
            "                <a href=\"/manhua/\">漫画</a>\n" +
            "                <a href=\"/readbook.html\" style=\"width:25%;\">阅读记录</a>\n" +
            "                <script>DaoCaoRen.getCode('muser');</script>\n" +
            "            </div>\n" +
            "        </div>\n" +
            "        <div class=\"container\">\n" +
            "            <div class=\"nav hidden-xs\">\n" +
            "                <ul class=\"nav-pc\">\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"//www.daocaorenshuwu.com\">首页</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/book.html\">图书</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/xiazai.html\">电子书</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/manhua/\">漫画</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/lianzai/\">连载</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/wanjie/\">全本</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/writer/\">作者</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/haoshutuijian/\">推书</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/guestbook/\">留言</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/paihang.html\">排行榜</a>\n" +
            "                    </li>\n" +
            "                    <li class=\"fl\">\n" +
            "                        <a href=\"/readbook.html\">临时书架</a>\n" +
            "                    </li>\n" +
            "                    <script>DaoCaoRen.getCode('pcuser');</script>\n" +
            "                </ul>\n" +
            "            </div>\n" +
            "            <div class=\"search row\">\n" +
            "                <div class=\"col-sm-4 col-xs-12\">\n" +
            "                    <form id=\"search-form\" action=\"//www.daocaorenshuwu.com/plus/search.php\">\n" +
            "                        <div class=\"input-group\">\n" +
            "                            <input type=\"text\" class=\"form-control\" placeholder=\"请输入书名或者作者\" id=\"bdcsMain\" name=\"q\" />\n" +
            "                            <div class=\"input-group-addon\" onclick=\"DaoCaoRen.search();\">\n" +
            "                                <span class=\"fa fa-search\"></span>\n" +
            "                            </div>\n" +
            "                        </div>\n" +
            "                    </form>\n" +
            "                </div>\n" +
            "                <div class=\"col-sm-2 hidden-xs\">\n" +
            "                    <div class=\"dropdown\">\n" +
            "                        <div class=\"dropdown-toggle btn btn-default\" id=\"dLabel\" data-toggle=\"dropdown\">\n" +
            "                            <i class=\"fa fa-history\" aria-hidden=\"true\"></i> 阅读记录\n" +
            "                            <span class=\"caret\"></span>\n" +
            "                        </div>\n" +
            "                        <ul class=\"dropdown-menu\" aria-labelledby=\"dLabel\" id=\"history\"></ul>\n" +
            "                    </div>\n" +
            "                </div>\n" +
            "                <div class=\"col-sm-6 hidden-xs\">\n" +
            "                    <script>DaoCaoRen.getCode(\"baidushare\");</script>\n" +
            "                </div>\n" +
            "            </div>\n" +
            "        </div>\n" +
            "        <!-- Nav End -->\n" +
            "        <div class=\"container\">\n" +
            "            <div class=\"panel panel-info\">\n" +
            "                <div class=\"panel-heading\">\n" +
            "                    <h1 class=\"panel-title\">搜索含有“\n" +
            "                        <strong style=\"color: red;\">啊</strong>”的书籍\n" +
            "                    </h1>\n" +
            "                </div>\n" +
            "                <div class=\"panel-body\">\n" +
            "                    <table class=\"table table-condensed\">\n" +
            "                        <thead>\n" +
            "                            <tr>\n" +
            "                                <th>书名</th>\n" +
            "                                <th>作者</th>\n" +
            "                                <th>下载</th>\n" +
            "                            </tr>\n" +
            "                        </thead>\n" +
            "                        <tbody>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/manhua/huangshangjixiang/\" title=\"皇上吉祥\" target=\"_blank\" class=\"orange\">《皇上吉祥》</a>\n" +
            "                                </td>\n" +
            "                                <td>泥巴啊哈</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/1376.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/wojianggexiaohuanikebiekua/\" title=\"我讲个笑话，你可别哭啊\" target=\"_blank\" class=\"orange\">《我讲个笑话，你可别哭啊》</a>\n" +
            "                                </td>\n" +
            "                                <td>囧叔</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/1435.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/wojianggegushinikebiedangzhena/\" title=\"我讲个故事，你可别当真啊\" target=\"_blank\" class=\"orange\">《我讲个故事，你可别当真啊》</a>\n" +
            "                                </td>\n" +
            "                                <td>囧叔</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/1436.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/feimengwurao/\" title=\"少侠，非萌勿扰啊！\" target=\"_blank\" class=\"orange\">《少侠，非萌勿扰啊！》</a>\n" +
            "                                </td>\n" +
            "                                <td>忆锦</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/6459.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/bianmohuakai/\" title=\"彼岸墨花开\" target=\"_blank\" class=\"orange\">《彼岸墨花开》</a>\n" +
            "                                </td>\n" +
            "                                <td>起什么名啊</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/7678.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/wobushidamingxinga/\" title=\"我不是大明星啊\" target=\"_blank\" class=\"orange\">《我不是大明星啊》</a>\n" +
            "                                </td>\n" +
            "                                <td>巫马行</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/8991.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/laiayiqilutuanzi/\" title=\"来啊，一起撸团子！\" target=\"_blank\" class=\"orange\">《来啊，一起撸团子！》</a>\n" +
            "                                </td>\n" +
            "                                <td>云弎</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/10616.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/book/nanzhuweiwonaolihun/\" title=\"男主为我闹离婚\" target=\"_blank\" class=\"orange\">《男主为我闹离婚》</a>\n" +
            "                                </td>\n" +
            "                                <td>糯糯啊</td>\n" +
            "                                <td>\n" +
            "                                    <a href=\"/txt/10625.html\" target=\"_blank\">TXT下载</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                            <tr>\n" +
            "                                <td>\n" +
            "                                    <a href=\"https://www.wanjiexianwang.com/so/search.html?searchkey=啊\" target=\"_blank\" class=\"orange\">如果没搜到《啊》请点击这里</a>\n" +
            "                                </td>\n" +
            "                            </tr>\n" +
            "                        </tbody>\n" +
            "                    </table>\n" +
            "                </div>\n" +
            "            </div>\n" +
            "            <div class=\"page\">\n" +
            "                <ul class=\"pagination pagination-sm\">\n" +
            "                    <li>\n" +
            "                        <a>共1页/8条记录</a>\n" +
            "                    </li>\n" +
            "                </ul>\n" +
            "            </div>\n" +
            "        </div>\n" +
            "        <!-- Footer Begin -->\n" +
            "        <div class=\"footer\">\n" +
            "            <div class = \"container\">\n" +
            "                <p>Copyright © 2017-2018 \n" +
            "                    <a href=\"//www.daocaorenshuwu.com\" target = \"_blank\">稻草人书屋</a> All Rights Reserved\n" +
            "                </p>\n" +
            "                <p class = \"hidden-xs\">本站所有书籍都是程序自动从第三方网站抓取的，如果版权人认为在本站放置您的作品有损您的利益，请发邮件至\n" +
            "                    <script>DaoCaoRen.getCode(\"email\");</script>，本站确认后将会无条件删除。\n" +
            "                </p>\n" +
            "                <p class = \"hidden-xs\">本站所收录作品、社区话题、书库评论均属其个人行为，不代表本站立场。</p>\n" +
            "                <p>有能力者，请一定订阅和购买正版书籍支持作者，这样作者才能写出更多更好的书！</p>\n" +
            "                <p class = \"hidden-xs\">Power by \n" +
            "                    <a href=\"//www.daocaorenshuwu.com\" target=\"_blank\">WWW.DaoCaoRenShuWu.COM</a>，\n" +
            "                    <a href=\"/sitemap.html\">Baidu SiteMap</a>，\n" +
            "                    <a href=\"/sitemap.xml\">Google SiteMap</a>\n" +
            "                    <script>DaoCaoRen.getCode(\"tongji\");</script>\n" +
            "                </p>\n" +
            "            </div>\n" +
            "        </div>\n" +
            "        <div class=\"back-to-top\" id=\"back-to-top\" title=\"返回顶部\">\n" +
            "            <i class=\"fa fa-chevron-up\"></i>\n" +
            "        </div>\n" +
            "        <!-- Footer End -->\n" +
            "        <script type=\"text/javascript\">\n" +
            "      \$(function(){\n" +
            "        DaoCaoRen.getBookHistory(\"bookRead\");\n" +
            "        DaoCaoRen.getHistoryDropdown();\n" +
            "      }); \n" +
            "    </script>\n" +
            "    </body>\n" +
            "</html>"
    val document = Jsoup.parse(s)
    val select = document
            .select("td:nth-child(2)")

    val s1 = "a@attr->title"

    if (s1.contains("@attr->")) {
        val a = document.select(s1.split("@").first())
                .map { it.attr(s1.split("@attr->").last()) }
                .filter { it.isNotBlank() }



    }

    document.select("tbody > tr").forEach {
        val map = emptyMap<String, String>()
        val title = it.select("a").attr("title")
        val author = it.select("td:nth-child(2)").text()
        val link = it.select("a").attr("href")
        println("title: " +  title)
        println("author: " + author)
        println("link: " + link)
    }





//    document.select("")

//    select.forEach {
//        println(it.text())
//    }
}
