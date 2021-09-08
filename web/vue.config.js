// vue.config.js
module.exports = {
  publicPath: "./",
  productionSourceMap: false,
  devServer: {
    port: 8081
  },
  pwa: {
    name: "阅读",
    themeColor: "#ffffff",
    msTileColor: "#000000"

    // appleMobileWebAppCapable: 'no',
    // appleMobileWebAppStatusBarStyle: 'default',
  }
};
