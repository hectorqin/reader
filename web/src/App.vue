<template>
  <div id="app">
    <router-view></router-view>
  </div>
</template>

<script>
export default {
  name: "app",
  components: {},
  beforeCreate() {
    // console.log(this);
    var config = JSON.parse(localStorage.getItem("config"));
    if (config != null) this.$store.commit("setConfig", config);
    this.$store.commit("setMiniInterface", window.innerWidth <= 750);
    window.onresize = () => {
      this.$store.commit("setMiniInterface", window.innerWidth <= 750);
      this.$store.commit("setWindowSize", {
        width: window.innerWidth,
        height: window.innerHeight
      });
      this.$store.commit("setTouchable", "ontouchstart" in document);
    };
  },
  mounted() {
    if (this.theme) {
      document.body.className =
        (document.body.className || "").replace("night-theme", "") +
        " night-theme";
    } else {
      document.body.className = (document.body.className || "").replace(
        "night-theme",
        ""
      );
    }
    window.reader = this;
  },
  computed: {
    isNight() {
      return this.$store.getters.isNight;
    }
  },
  watch: {
    isNight(val) {
      if (val) {
        document.body.className =
          document.body.className.replace("night-theme", "") + " night-theme";
      } else {
        document.body.className = document.body.className.replace(
          "night-theme",
          ""
        );
      }
    }
  }
};
</script>

<style>
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  margin: 0;
  height: 100%;
}

@font-face {
  font-family: "reader-st";
  src: local("Songti SC"), local("Noto Serif CJK SC"),
    local("Source Han Serif SC"), local("Source Han Serif CN"), local("STSong"),
    local("宋体"), local("明体"), local("明朝"), local("Songti"),
    local("Songti TC"), /*iOS6+iBooks3*/ local("Song S"), local("Song T"),
    local("STBShusong"), local("TBMincho"), local("HYMyeongJo"),
    /*Kindle Paperwihite*/ local("DK-SONGTI");
}

@font-face {
  font-family: "reader-fs";
  src: local("STFangsong"), local("FangSong"), local("FangSong_GB2312"),
    local("amasis30"), local("仿宋"), local("仿宋_GB2312"), local("Yuanti"),
    local("Yuanti SC"), local("Yuanti TC"),
    /*iOS6+iBooks3*/ local("DK-FANGSONG");
}

@font-face {
  font-family: "reader-kt";
  src: local("Kaiti SC"), local("STKaiti"), local("Caecilia"), local("楷体"),
    local("楷体_GB2312"), local("Kaiti"), local("Kaiti SC"), local("Kaiti TC"),
    /*iOS6+iBooks3*/ local("MKai PRC"), local("MKaiGB18030C-Medium"),
    local("MKaiGB18030C-Bold"), /*Kindle Paperwihite*/ local("DK-KAITI");
}

@font-face {
  font-family: "reader-ht";
  src: local("Noto Sans CJK SC"), local("Source Han Sans SC"),
    local("Source Han Sans CN"), local("Microsoft YaHei"), local("PingFang SC"),
    local("Hiragino Sans GB"), local("黑体"), local("微软雅黑"), local("Heiti"),
    local("Heiti SC"), local("Heiti TC"), /*iOS6+iBooks3*/ local("MYing Hei S"),
    local("MYing Hei T"), local("TBGothic"),
    /*Kindle Paperwihite*/ local("DK-HEITI");
}
*::-webkit-scrollbar {
  width: 0 !important;
}
</style>
<style lang="stylus">
.popper-component {
  top: 0 !important;
}
@media screen and (max-width: 750px) {
  .popper-component {
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    box-sizing: border-box;
    margin: 0 !important;
  }
}
</style>
