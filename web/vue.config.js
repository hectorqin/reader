// vue.config.js
var packageInfo = require("./package.json");

function buildVersion() {
  const now = new Date();
  const pad = v => (v >= 10 ? "" + v : "0" + v);
  return (
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes())
  );
}
process.env.VUE_APP_BUILD_VERSION =
  process.env.VUE_APP_BUILD_VERSION ||
  "v" + packageInfo.version + "-" + buildVersion();

module.exports = {
  publicPath: "./",
  productionSourceMap: false,
  devServer: {
    port: 8081
  },
  pwa: {
    name: "阅读",
    themeColor: "#ffffff",
    msTileColor: "#000000",

    appleMobileWebAppCapable: "yes",
    appleMobileWebAppStatusBarStyle: "black-translucent",

    // manifestOptions: {
    //   display: "standalone"
    // }

    // configure the workbox plugin
    // workboxPluginMode: "InjectManifest",
    workboxOptions: {
      // swSrc is required in InjectManifest mode.
      // swSrc: "src/service-worker.js"
      // ignoreURLParametersMatching: [new RegExp("accessToken")],
      exclude: ["index.html"],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          // 首页
          urlPattern: new RegExp("^https://.*/index.html"),
          handler: "networkFirst",
          options: {
            cacheName: "home",
            cacheableResponse: {
              statuses: [200]
            }
          }
        },
        {
          // 获取书架
          urlPattern: new RegExp("^https://[^/]*/reader3/getBookshelf"),
          handler: "networkFirst",
          options: {
            cacheName: "bookshelf",
            cacheableResponse: {
              statuses: [200]
            }
          }
        },
        {
          // 获取书源
          urlPattern: new RegExp("^https://[^/]*/reader3/getSources"),
          handler: "networkFirst",
          options: {
            cacheName: "bookSources",
            cacheableResponse: {
              statuses: [200]
            }
          }
        },
        {
          // 获取书籍章节列表
          urlPattern: new RegExp("^https://[^/]*/reader3/getChapterList"),
          handler: "networkFirst",
          options: {
            cacheName: "bookChapterList",
            networkTimeoutSeconds: 5,
            cacheableResponse: {
              statuses: [200]
            }
          }
        },
        {
          // 获取书籍内容
          urlPattern: new RegExp("^https://[^/]*/reader3/getBookContent"),
          handler: "cacheFirst",
          options: {
            cacheName: "bookContent",
            cacheableResponse: {
              statuses: [200]
            },
            expiration: {
              maxAgeSeconds: 86400 * 30,
              maxEntries: 1000
            }
          }
        },
        {
          // 获取书籍封面
          urlPattern: new RegExp("^https://[^/]*/reader3/cover"),
          handler: "cacheFirst",
          options: {
            cacheName: "bookCover",
            cacheableResponse: {
              statuses: [200]
            },
            expiration: {
              maxAgeSeconds: 86400 * 30,
              maxEntries: 1000
            }
          }
        }
      ]
    }
  }
};
