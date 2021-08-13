<template>
  <div
    class="settings-wrapper"
    :style="popupTheme"
    :class="{ night: isNight, day: !isNight }"
  >
    <div class="settings-title">设置</div>
    <div class="setting-list">
      <ul>
        <li class="theme-list">
          <i>阅读主题</i>
          <span
            class="theme-item"
            v-for="(themeColor, index) in themeColors"
            :key="index"
            :style="themeColor"
            ref="themes"
            @click="setTheme(index)"
            :class="{ selected: selectedTheme == index }"
            ><em v-if="index < 6" class="iconfont">&#58980;</em
            ><em v-else class="moon-icon">{{ moonIcon }}</em></span
          >
        </li>
        <li class="font-list">
          <i>正文字体</i>
          <span
            class="font-item"
            v-for="(font, index) in fonts"
            :key="index"
            :class="{ selected: selectedFont == index }"
            @click="setFont(index)"
            >{{ font }}</span
          >
        </li>
        <li class="font-size">
          <i>字体大小</i>
          <div class="resize">
            <span class="less" @click="lessFontSize"
              ><em class="iconfont">&#58966;</em></span
            ><b></b> <span class="lang">{{ fontSize }}</span
            ><b></b>
            <span class="more" @click="moreFontSize"
              ><em class="iconfont">&#58976;</em></span
            >
          </div>
        </li>
        <li class="read-width">
          <i>页面宽度</i>
          <div class="resize">
            <span class="less" @click="lessReadWidth"
              ><em class="iconfont">&#58965;</em></span
            ><b></b> <span class="lang">{{ readWidth }}</span
            ><b></b>
            <span class="more" @click="moreReadWidth"
              ><em class="iconfont">&#58975;</em></span
            >
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import "../assets/fonts/popfont.css";
import "../assets/fonts/iconfont.css";
import config from "../plugins/config";
export default {
  name: "ReadSettings",
  data() {
    return {
      theme: 0,
      isNight: this.$store.state.config.theme == 6,
      moonIcon: "",
      themeColors: [
        {
          background: "rgba(250, 245, 235, 0.8)"
        },
        {
          background: "rgba(245, 234, 204, 0.8)"
        },
        {
          background: "rgba(230, 242, 230, 0.8)"
        },
        {
          background: "rgba(228, 241, 245, 0.8)"
        },
        {
          background: "rgba(245, 228, 228, 0.8)"
        },
        {
          background: "rgba(224, 224, 224, 0.8)"
        },
        {
          background: "rgba(0, 0, 0, 0.5)"
        }
      ],
      moonIconStyle: {
        display: "inline",
        color: "rgba(255,255,255,0.2)"
      },
      fonts: ["雅黑", "宋体", "楷书"]
    };
  },
  mounted() {
    //初始化设置项目
    var config = this.$store.state.config;
    this.theme = config.theme;
    if (this.theme == 6) {
      this.moonIcon = "";
    } else {
      this.moonIcon = "";
    }
  },
  computed: {
    config() {
      return this.$store.state.config;
    },
    popupTheme() {
      return {
        background: config.themes[this.config.theme].popup
      };
    },
    selectedTheme() {
      return this.$store.state.config.theme;
    },
    selectedFont() {
      return this.$store.state.config.font;
    },
    fontSize() {
      return this.$store.state.config.fontSize;
    },
    readWidth() {
      return this.$store.state.config.readWidth;
    }
  },
  methods: {
    setTheme(theme) {
      if (theme == 6) {
        this.isNight = true;
        this.moonIcon = "";
        this.moonIconStyle.color = "#ed4259";
      } else {
        this.isNight = false;
        this.moonIcon = "";
        this.moonIconStyle.color = "rgba(255,255,255,0.2)";
      }
      let config = this.config;
      config.theme = theme;
      this.$store.commit("setConfig", config);
    },
    setFont(font) {
      let config = this.config;
      config.font = font;
      this.$store.commit("setConfig", config);
    },
    moreFontSize() {
      let config = this.config;
      if (config.fontSize < 48) config.fontSize += 2;
      this.$store.commit("setConfig", config);
    },
    lessFontSize() {
      let config = this.config;
      if (config.fontSize > 12) config.fontSize -= 2;
      this.$store.commit("setConfig", config);
    },
    moreReadWidth() {
      let config = this.config;
      if (config.readWidth < 960) config.readWidth += 160;
      this.$store.commit("setConfig", config);
    },
    lessReadWidth() {
      let config = this.config;
      if (config.readWidth > 640) config.readWidth -= 160;
      this.$store.commit("setConfig", config);
    }
  }
};
</script>

<style lang="stylus" scoped>
>>>.iconfont {
  font-family: iconfont;
  font-style: normal;
}

>>>.moon-icon {
  font-family: iconfont;
  font-style: normal;
}

.settings-wrapper {
  user-select: none;
  margin: -13px;
  width: 478px;
  height: 300px;
  text-align: left;
  padding: 40px 0 40px 24px;
  background: #ede7da url('../assets/imgs/themes/popup_1.png') repeat;

  .settings-title {
    font-size: 18px;
    line-height: 22px;
    margin-bottom: 28px;
    font-family: FZZCYSK;
    font-weight: 400;
  }

  .setting-list {
    ul {
      list-style: none outside none;
      margin: 0;
      padding: 0;

      li {
        list-style: none outside none;

        i {
          font: 12px / 16px PingFangSC-Regular, '-apple-system', Simsun;
          display: inline-block;
          min-width: 48px;
          margin-right: 16px;
          vertical-align: middle;
          color: #666;
        }

        .theme-item {
          line-height: 32px;
          width: 34px;
          height: 34px;
          margin-right: 16px;
          border-radius: 100%;
          display: inline-block;
          cursor: pointer;
          text-align: center;
          vertical-align: middle;

          .iconfont {
            display: none;
          }
        }

        .selected {
          color: #ed4259;

          .iconfont {
            display: inline;
          }
        }
      }

      .font-list {
        margin-top: 28px;

        .font-item {
          width: 78px;
          height: 34px;
          cursor: pointer;
          margin-right: 16px;
          border-radius: 2px;
          text-align: center;
          vertical-align: middle;
          display: inline-block;
          font: 14px / 34px PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', 'Microsoft YaHei', sans-serif;
        }

        .selected {
          color: #ed4259;
          border: 1px solid #ed4259;
        }

        .font-item:hover {
          border: 1px solid #ed4259;
          color: #ed4259;
        }
      }

      .font-size, .read-width {
        margin-top: 28px;

        .resize {
          display: inline-block;
          width: 274px;
          height: 34px;
          vertical-align: middle;
          border-radius: 2px;

          span {
            width: 89px;
            height: 34px;
            line-height: 34px;
            display: inline-block;
            cursor: pointer;
            text-align: center;
            vertical-align: middle;

            em {
              font-style: normal;
            }
          }

          .less:hover, .more:hover {
            color: #ed4259;
          }

          .lang {
            color: #a6a6a6;
            font-weight: 400;
            font-family: FZZCYSK;
          }

          b {
            display: inline-block;
            height: 20px;
            vertical-align: middle;
          }
        }
      }
    }
  }
}

.night {
  >>>.theme-item {
    border: 1px solid #666;
  }

  >>>.selected {
    border: 1px solid #666;
  }

  >>>.moon-icon {
    color: #ed4259;
  }

  >>>.font-list {
    .font-item {
      border: 1px solid #666;
      background: rgba(45, 45, 45, 0.5);
    }
  }

  >>>.resize {
    border: 1px solid #666;
    background: rgba(45, 45, 45, 0.5);

    b {
      border-right: 1px solid #666;
    }
  }
}

.day {
  >>>.theme-item {
    border: 1px solid #e5e5e5;
  }

  >>>.selected {
    border: 1px solid #ed4259;
  }

  >>>.moon-icon {
    display: inline;
    color: rgba(255, 255, 255, 0.2);
  }

  >>>.font-list {
    .font-item {
      background: rgba(255, 255, 255, 0.5);
      border: 1px solid rgba(0, 0, 0, 0.1);
    }
  }

  >>>.resize {
    border: 1px solid #e5e5e5;
    background: rgba(255, 255, 255, 0.5);

    b {
      border-right: 1px solid #e5e5e5;
    }
  }
}
</style>
