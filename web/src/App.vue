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
    window.reader = this;
    this.setTheme(this.isNight);
  },
  computed: {
    isNight() {
      return this.$store.getters.isNight;
    }
  },
  watch: {
    isNight(val) {
      this.setTheme(val);
    }
  },
  methods: {
    setTheme(isNight) {
      if (isNight) {
        document.body.className =
          (document.body.className || "").replace("night-theme", "") +
          " night-theme";
      } else {
        document.body.className = (document.body.className || "").replace(
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
.night-theme {
  .el-message-box {
    background: #212121;
    border: 1px solid #212121;
    .el-message-box__title {
      color: #888;
    }
    .el-message-box__content {
      color: #777;
    }
  }
  .el-button--default {
    background: #888;
    color: #ddd;
    border: 1px solid #888;
  }
  .el-button--primary {
    background: #185798;
    border: 1px solid #185798;
  }
  .el-checkbox__inner {
    background: #bbb;
  }
  .el-input__inner {
    background-color: #bbb;
    border: 1px solid #bbb !important;
    color: #ddd;
  }
  .el-select-dropdown {
    background-color: #333;
    border: 1px solid #333 !important;
  }
  .el-select-dropdown__item {
    color: #ddd;
  }
  .el-select-dropdown__item.hover, .el-select-dropdown__item:hover {
    background-color: #444;
  }
  .el-popper[x-placement^="bottom"] .popper__arrow, .el-popper[x-placement^="bottom"] .popper__arrow::after {
    border-bottom-color: #333 !important;
  }
  .el-popper[x-placement^="top"] .popper__arrow, .el-popper[x-placement^="top"] .popper__arrow::after {
    border-top-color: #333 !important;
  }
}
.el-popover:focus, .el-popover:focus:active, .el-popover__reference:focus:hover, .el-popover__reference:focus:not(.focusing) {
  outline: none;
}
</style>
