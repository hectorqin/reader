<template>
  <div
    class="settings-wrapper"
    :style="popupTheme"
    :class="{ night: $store.getters.isNight, day: !$store.getters.isNight }"
  >
    <div class="settings-title">
      设置
      <div class="title-btn" @click="resetConfig">重置为默认配置</div>
    </div>
    <div class="setting-list">
      <ul>
        <li>
          <span class="setting-item-title">特殊模式</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(type, index) in pageTypes"
              :key="index"
              :class="{ selected: pageType == type }"
              @click="setPageType(type)"
              >{{ type }}</span
            >
            <span class="small-tip"
              >❗️开启 Kindle 模式会关闭动画以及首页的部分功能</span
            >
          </div>
        </li>
        <el-divider></el-divider>
        <li>
          <span class="setting-item-title">配置方案</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(customConfig, index) in $store.state.customConfigList"
              :key="index"
              :class="{
                selected:
                  $store.getters.config.customConfig === customConfig.name
              }"
              @click="setCustomConfig(customConfig)"
            >
              <span>{{ customConfig.name }}</span>
              <i
                class="el-icon-close delete-custom-config-icon"
                v-if="
                  index > 1 &&
                    $store.getters.config.customConfig !== customConfig.name
                "
                @click.stop="deleteCustomConfig(index, customConfig.name)"
              ></i>
            </span>
            <span
              class="span-item"
              :key="'addNewCustomConfig'"
              @click="addNewCustomConfig"
              >新增方案</span
            >
            <span
              class="span-item"
              :key="'autoTheme'"
              ref="themes"
              @click="setAutoTheme"
              :class="{ selected: $store.getters.config.autoTheme }"
              >自动切换</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">方案类型</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(configDefaultType, index) in configDefaultTypeList"
              :key="index"
              :class="{
                selected:
                  currentCustomConfig.configDefaultType === configDefaultType
              }"
              @click="setConfigDefaultType(configDefaultType)"
              >{{ configDefaultType }}</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">阅读主题</span>
          <div class="selection-zone">
            <span
              class="theme-item"
              v-for="(themeColor, index) in themeColors"
              :key="index"
              :style="themeColor"
              ref="themes"
              @click="setTheme(index)"
              :class="{ selected: selectedTheme == index }"
              ><em v-if="index != 6" class="iconfont">&#58980;</em
              ><em v-else class="moon-icon">{{ moonIcon }}</em></span
            >
            <span
              class="span-item"
              :key="'custom'"
              ref="themes"
              @click="setTheme('custom')"
              :class="{ selected: selectedTheme == 'custom' }"
              >自定义</span
            >
          </div>
        </li>
        <li v-if="selectedTheme == 'custom'">
          <span class="setting-item-title">自定义</span>
          <div class="custom-theme">
            <div class="custom-theme-title">
              <span class="custom-theme-title">主题模式</span>
              <span
                class="span-item"
                v-for="(type, index) in themeTypes"
                :key="index"
                :class="{ selected: themeType == type }"
                @click="setThemeType(type)"
                >{{ type === "day" ? "白天" : "黑夜" }}</span
              >
            </div>
            <span class="custom-theme-title"
              >页面背景颜色
              <el-color-picker v-model="bodyColor"></el-color-picker>
            </span>
            <span class="custom-theme-title"
              >浮窗背景颜色
              <el-color-picker v-model="popupColor"></el-color-picker
            ></span>
            <span class="custom-theme-title"
              >阅读背景颜色
              <el-color-picker v-model="contentColor"></el-color-picker
            ></span>
            <span class="custom-theme-title"
              >阅读背景图片
              <img
                class="content-bg-preview"
                v-for="(item, index) in builtinBG"
                :key="index"
                :class="{
                  selected: $store.getters.config.contentBGImg == item.src
                }"
                :src="item.src"
                alt=""
                @click="setBGImg(item.src)"
              />
              <div
                class="content-bg-preview"
                v-for="item in $store.getters.config.customBGImgList || []"
                :key="item"
                :class="{
                  selected: $store.getters.config.contentBGImg == item
                }"
              >
                <img
                  :src="getCustomBGImgURL(item)"
                  alt=""
                  @click="setBGImg(item)"
                />
                <i
                  class="el-icon-close delete-bg-icon"
                  @click.stop="deleteCustomBGImg(item)"
                ></i>
              </div>

              <span class="upload-bg-btn" @click="uploadBGFile">上传</span>
              <input
                ref="bgFileRef"
                type="file"
                @change="onBGFileChange"
                style="display:none"
              />
            </span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">正文字体</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(font, index) in fonts"
              :key="index"
              :class="{ selected: selectedFont == index }"
              @click="setFont(index)"
              >{{ font }}</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">字体大小</span>
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
        <li>
          <span class="setting-item-title">字体粗细</span>
          <div class="resize">
            <span class="less" @click="lessFontWeight"
              ><em class="iconfont">&#58966;</em></span
            ><b></b> <span class="lang">{{ fontWeight }}</span
            ><b></b>
            <span class="more" @click="moreFontWeight"
              ><em class="iconfont">&#58976;</em></span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">段落行高</span>
          <div class="resize">
            <span class="less" @click="lessLineHeight"
              ><em class="iconfont">&#58966;</em></span
            ><b></b> <span class="lang">{{ lineHeight }}</span
            ><b></b>
            <span class="more" @click="moreLineHeight"
              ><em class="iconfont">&#58976;</em></span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">段落间距</span>
          <div class="resize">
            <span class="less" @click="lessParagraphSpace"
              ><em class="iconfont">&#58966;</em></span
            ><b></b> <span class="lang">{{ paragraphSpace }}</span
            ><b></b>
            <span class="more" @click="moreParagraphSpace"
              ><em class="iconfont">&#58976;</em></span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title font-color-title">字体颜色</span>
          <el-color-picker v-model="fontColor"></el-color-picker>
        </li>
        <li>
          <span class="setting-item-title">页面模式</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(mode, index) in pageModes"
              :key="index"
              :class="{ selected: pageMode == mode }"
              @click="setPageMode(mode)"
              >{{ mode }}</span
            >
          </div>
        </li>
        <li v-if="!$store.state.miniInterface">
          <span class="setting-item-title">页面宽度</span>
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
        <li>
          <span class="setting-item-title">翻页方式</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(method, index) in readMethods"
              :key="index"
              :class="{ selected: readMethod == method }"
              @click="setReadMethod(method)"
              v-show="
                (!$store.state.miniInterface && method !== '左右滑动') ||
                  $store.state.miniInterface
              "
              >{{ method }}</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">动画时长</span>
          <div class="resize">
            <span class="less" @click="lessAnimateMSTime"
              ><i class="el-icon-minus"></i></span
            ><b></b> <span class="lang">{{ animateMSTime }}</span
            ><b></b>
            <span class="more" @click="moreAnimateMSTime"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">翻页速度</span>
          <div class="resize">
            <span class="less" @click="lessAutoReadingLineTime"
              ><i class="el-icon-minus"></i></span
            ><b></b> <span class="lang">{{ config.autoReadingLineTime }}</span
            ><b></b>
            <span class="more" @click="moreAutoReadingLineTime"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">全屏点击</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(method, index) in clickMethods"
              :key="index"
              :class="{ selected: clickMethod == method }"
              @click="setClickMethod(method)"
              >{{ method }}</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">选择文字</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(action, index) in selectionActions"
              :key="index"
              :class="{ selected: selectionAction == action }"
              @click="setSelectionAction(action)"
              >{{ action }}</span
            >
          </div>
        </li>
        <el-divider></el-divider>
        <li class="operation-zone">
          <span class="span-btn" @click="showClickZone">显示翻页区域</span>
          <span class="span-btn" @click="showRuleEditor">过滤规则管理</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import "../assets/fonts/iconfont.css";
import Axios from "../plugins/axios";
import settings from "../plugins/config";
import eventBus from "../plugins/eventBus";
import { isMiniInterface } from "../plugins/helper";
import { setCache, getCache } from "../plugins/cache";

export default {
  name: "ReadSettings",
  data() {
    return {
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
        },
        {
          background: "rgba(255, 255, 255, 0.8)"
        }
      ],
      fontColor:
        this.$store.state.config.fontColor ||
        (!this.$store.getters.isNight ? "#262626" : "#666666"),
      bodyColor: this.$store.state.config.bodyColor || "#eadfca",
      contentColor: this.$store.state.config.contentColor || "#ede7da",
      popupColor: this.$store.state.config.popupColor || "#ede7da",
      builtinBG: [
        { src: "bg/山水画.jpg" },
        { src: "bg/山水墨影.jpg" },
        { src: "bg/羊皮纸1.jpg" },
        { src: "bg/护眼漫绿.jpg" },
        { src: "bg/羊皮纸2.jpg" },
        { src: "bg/新羊皮纸.jpg" },
        { src: "bg/羊皮纸3.jpg" },
        { src: "bg/明媚倾城.jpg" },
        { src: "bg/羊皮纸4.jpg" },
        { src: "bg/深宫魅影.jpg" },
        { src: "bg/午后沙滩.jpg" },
        { src: "bg/清新时光.jpg" },
        { src: "bg/宁静夜色.jpg" },
        { src: "bg/边彩画布.jpg" }
      ],
      fonts: ["系统", "黑体", "楷体", "宋体", "仿宋"],
      readMethods: ["上下滑动", "左右滑动", "上下滚动"],
      clickMethods: ["下一页", "自动", "不翻页"],
      selectionActions: ["过滤弹窗", "忽略"],
      pageModes: ["自适应", "手机模式"],
      pageTypes: ["正常", "Kindle"],
      themeTypes: ["day", "night"],
      configDefaultTypeList: ["白天默认", "黑夜默认"]
    };
  },
  mounted() {},
  computed: {
    config() {
      return this.$store.state.config;
    },
    moonIcon() {
      return this.$store.getters.isSystemNight ? "" : "";
    },
    moonIconStyle() {
      return {
        display: "inline",
        color: this.$store.getters.isSystemNight
          ? "#ed4259"
          : "rgba(255,255,255,0.2)"
      };
    },
    popupTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popup
      };
    },
    selectedTheme() {
      return this.$store.state.config.theme;
    },
    selectedFont() {
      return this.$store.state.config.font;
    },
    pageMode() {
      return this.$store.state.config.pageMode ?? settings.config.pageMode;
    },
    pageType() {
      return this.$store.state.config.pageType ?? settings.config.pageType;
    },
    themeType() {
      return this.$store.state.config.themeType ?? settings.config.themeType;
    },
    readMethod() {
      return this.$store.state.config.readMethod ?? settings.config.readMethod;
    },
    clickMethod() {
      return (
        this.$store.state.config.clickMethod ?? settings.config.clickMethod
      );
    },
    selectionAction() {
      return (
        this.$store.state.config.selectionAction ??
        settings.config.selectionAction
      );
    },
    fontSize() {
      return this.$store.state.config.fontSize;
    },
    fontWeight() {
      return this.$store.state.config.fontWeight ?? settings.config.fontWeight;
    },
    lineHeight() {
      return this.$store.state.config.lineHeight ?? settings.config.lineHeight;
    },
    paragraphSpace() {
      return (
        this.$store.state.config.paragraphSpace ??
        settings.config.paragraphSpace
      );
    },
    readWidth() {
      return this.$store.state.config.readWidth;
    },
    animateMSTime() {
      return this.$store.state.config.animateMSTime;
    },
    currentCustomConfig() {
      return this.$store.state.customConfigList.find(
        v => v.name === this.$store.state.config.customConfig
      );
    }
  },
  watch: {
    fontColor(color) {
      let config = this.config;
      config.fontColor = color;
      this.$store.commit("setConfig", { ...config });
    },
    bodyColor(color) {
      let config = this.config;
      config.bodyColor = color;
      this.$store.commit("setConfig", { ...config });
    },
    popupColor(color) {
      let config = this.config;
      config.popupColor = color;
      this.$store.commit("setConfig", { ...config });
    },
    contentColor(color) {
      let config = this.config;
      config.contentColor = color;
      this.$store.commit("setConfig", { ...config });
    }
  },
  methods: {
    setTheme(theme) {
      let config = this.config;
      config.theme = theme;
      this.$store.commit("setConfig", config);
    },
    setAutoTheme() {
      let config = this.config;
      config.autoTheme = !config.autoTheme;
      this.$store.commit("setConfig", config);
    },
    setFont(font) {
      let config = this.config;
      config.font = font;
      this.$store.commit("setConfig", config);
    },
    setReadMethod(method) {
      this.$emit("readMethodChange");
      let config = this.config;
      config.readMethod = method;
      this.$store.commit("setConfig", config);
    },
    setPageMode(mode) {
      this.$emit("pageModeChange");
      let config = this.config;
      config.pageMode = mode;
      this.$store.commit("setConfig", config);
      if (mode === "手机模式") {
        this.$store.commit("setMiniInterface", true);
      } else {
        this.$store.commit("setMiniInterface", isMiniInterface());
      }
    },
    setPageType(type) {
      if (type === this.config.pageType) {
        return;
      }
      let lastConfig = {};
      if (type === "Kindle") {
        setCache("lastNormalConfig", this.config);

        lastConfig = getCache("lastKindleConfig");
        lastConfig = lastConfig || {
          animateMSTime: 0,
          fontSize: Math.min(this.fontSize, 20),
          theme: 7,
          readMethod: "左右滑动",
          selectionAction: "忽略",
          pageMode: "手机模式"
        };
      } else {
        setCache("lastKindleConfig", this.config);
        lastConfig = getCache("lastNormalConfig") || {};
      }

      const config = { ...this.config, ...(lastConfig || {}) };
      config.pageType = type;
      this.$store.commit("setConfig", config);

      this.$emit("readMethodChange");
      this.$emit("pageModeChange");
      if (config.pageMode === "手机模式") {
        this.$store.commit("setMiniInterface", true);
      } else {
        this.$store.commit("setMiniInterface", isMiniInterface());
      }
    },
    setThemeType(type) {
      let config = this.config;
      config.themeType = type;
      this.$store.commit("setConfig", config);
    },
    setClickMethod(method) {
      let config = this.config;
      config.clickMethod = method;
      this.$store.commit("setConfig", config);
    },
    setSelectionAction(action) {
      let config = this.config;
      config.selectionAction = action;
      this.$store.commit("setConfig", config);
    },
    moreFontSize() {
      let config = this.config;
      if (config.fontSize < 60) config.fontSize += 1;
      this.$store.commit("setConfig", config);
    },
    lessFontSize() {
      let config = this.config;
      if (config.fontSize > 10) config.fontSize -= 1;
      this.$store.commit("setConfig", config);
    },
    moreFontWeight() {
      let config = this.config;
      config.fontWeight = config.fontWeight || settings.config.fontWeight;
      if (config.fontWeight < 900) config.fontWeight += 100;
      this.$store.commit("setConfig", config);
    },
    lessFontWeight() {
      let config = this.config;
      config.fontWeight = config.fontWeight || settings.config.fontWeight;
      if (config.fontWeight > 100) config.fontWeight -= 100;
      this.$store.commit("setConfig", config);
    },
    moreAnimateMSTime() {
      let config = this.config;
      config.animateMSTime =
        typeof config.animateMSTime !== "undefined"
          ? config.animateMSTime
          : settings.config.animateMSTime;
      if (config.animateMSTime < 500) config.animateMSTime += 50;
      this.$store.commit("setConfig", config);
    },
    lessAnimateMSTime() {
      let config = this.config;
      config.animateMSTime =
        typeof config.animateMSTime !== "undefined"
          ? config.animateMSTime
          : settings.config.animateMSTime;
      if (config.animateMSTime >= 50) config.animateMSTime -= 50;
      this.$store.commit("setConfig", config);
    },
    moreAutoReadingLineTime() {
      let config = this.config;
      config.autoReadingLineTime =
        typeof config.autoReadingLineTime !== "undefined"
          ? config.autoReadingLineTime
          : settings.config.autoReadingLineTime;
      if (config.autoReadingLineTime < 10000) config.autoReadingLineTime += 50;
      this.$store.commit("setConfig", config);
    },
    lessAutoReadingLineTime() {
      let config = this.config;
      config.autoReadingLineTime =
        typeof config.autoReadingLineTime !== "undefined"
          ? config.autoReadingLineTime
          : settings.config.autoReadingLineTime;
      if (config.autoReadingLineTime >= 200) config.autoReadingLineTime -= 50;
      this.$store.commit("setConfig", config);
    },
    moreLineHeight() {
      let config = this.config;
      config.lineHeight = config.lineHeight || settings.config.lineHeight;
      if (config.lineHeight < 3) config.lineHeight += 0.2;
      config.lineHeight = +config.lineHeight.toFixed(1);
      this.$store.commit("setConfig", config);
    },
    lessLineHeight() {
      let config = this.config;
      config.lineHeight = config.lineHeight || settings.config.lineHeight;
      if (config.lineHeight > 1) config.lineHeight -= 0.2;
      config.lineHeight = +config.lineHeight.toFixed(1);
      this.$store.commit("setConfig", config);
    },
    moreParagraphSpace() {
      let config = this.config;
      config.paragraphSpace =
        config.paragraphSpace ?? settings.config.paragraphSpace;
      if (config.paragraphSpace < 3) config.paragraphSpace += 0.2;
      config.paragraphSpace = +config.paragraphSpace.toFixed(1);
      this.$store.commit("setConfig", config);
    },
    lessParagraphSpace() {
      let config = this.config;
      config.paragraphSpace =
        config.paragraphSpace ?? settings.config.paragraphSpace;
      if (config.paragraphSpace > 0) config.paragraphSpace -= 0.2;
      config.paragraphSpace = +config.paragraphSpace.toFixed(1);
      this.$store.commit("setConfig", config);
    },
    moreReadWidth() {
      let config = this.config;
      if (config.readWidth < settings.maxReadWidth) config.readWidth += 160;
      this.$store.commit("setConfig", config);
    },
    lessReadWidth() {
      let config = this.config;
      if (config.readWidth > settings.minReadWidth) config.readWidth -= 160;
      this.$store.commit("setConfig", config);
    },
    getCustomBGImgURL(src) {
      return this.api.replace(/\/reader3\/?/, "") + src;
    },
    setBGImg(src) {
      let config = this.config;
      if (config.contentBGImg === src) {
        delete config.contentBGImg;
      } else {
        config.contentBGImg = src;
      }
      this.$store.commit("setConfig", { ...config });
    },
    uploadBGFile() {
      this.$refs.bgFileRef.dispatchEvent(new MouseEvent("click"));
    },
    onBGFileChange(event) {
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      let param = new FormData();
      param.append("file", rawFile);
      param.append("type", "background");
      Axios.post(this.api + "/uploadFile", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess) {
            if (!res.data.data.length) {
              this.$message.error("上传文件失败");
              return;
            }
            let config = this.config;
            config.customBGImgList = config.customBGImgList || [];
            if (!config.customBGImgList.includes(res.data.data[0])) {
              config.customBGImgList.push(res.data.data[0]);
            }
            config.contentBGImg = res.data.data[0];
            this.$store.commit("setConfig", { ...config });
          }
        },
        error => {
          this.$message.error("上传文件失败 " + (error && error.toString()));
        }
      );
    },
    deleteCustomBGImg(src) {
      Axios.post(this.api + "/deleteFile", {
        url: src
      }).then(
        res => {
          if (res.data.isSuccess) {
            let config = this.config;
            config.customBGImgList = config.customBGImgList || [];
            var index = config.customBGImgList.indexOf(src);
            if (index != -1) {
              config.customBGImgList.splice(index, 1);
            }
            if (config.contentBGImg === src) {
              config.contentBGImg = this.builtinBG[0].src;
            }
            this.$store.commit("setConfig", { ...config });
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    resetConfig() {
      this.$store.commit("setConfig", { ...settings.config });
    },
    showClickZone() {
      this.$emit("close");
      this.$emit("showClickZone");
    },
    showRuleEditor() {
      this.$emit("close");
      eventBus.$emit("showReplaceRuleDialog");
      // eventBus.$emit(
      //   "showEditor",
      //   "修改过滤规则",
      //   JSON.stringify(this.$store.state.filterRules, null, 4),
      //   async (content, close) => {
      //     try {
      //       const filterRules = JSON.parse(content);
      //       if (!Array.isArray(filterRules)) {
      //         this.$message.error("过滤规则必须是JSON数组格式");
      //         return;
      //       }
      //       this.$store.commit("setFilterRules", filterRules);
      //       close();
      //     } catch (e) {
      //       this.$message.error("过滤规则必须是JSON数组格式");
      //     }
      //   }
      // );
    },
    async addNewCustomConfig() {
      const res = await this.$prompt("请输入方案名称", `添加配置方案`, {
        inputValue: "",
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValidator(v) {
          if (!v) {
            return "方案名不能为空";
          }
          return true;
        }
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      const name = res.value.replace(/^\s+/, "").replace(/\s+$/, "");
      if (!name) {
        return "方案名不能为空";
      }
      const isExist = this.$store.state.customConfigList.find(
        v => v.name === name
      );
      if (isExist) {
        return "方案名不能重复";
      }
      const newConfig = { ...this.$store.state.customConfigList[0] };
      newConfig.name = name;
      this.$store.commit(
        "setCustomConfigList",
        [].concat(this.$store.state.customConfigList).concat([newConfig])
      );
    },
    setCustomConfig(customConfig) {
      let config = this.config;
      config.customConfig = customConfig.name;
      config = { ...config, ...customConfig };
      this.$store.commit("setConfig", { ...config });
    },
    async deleteCustomConfig(index, name) {
      const customConfigList = [].concat(this.$store.state.customConfigList);
      if (index <= 1) {
        this.$message.error("内置方案不能删除");
        return;
      }
      if (customConfigList.length <= index) {
        this.$message.error("方案不存在");
        return;
      }
      if (this.$store.state.config.customConfig === name) {
        this.$message.error("方案正在使用，无法删除");
        return;
      }
      const res = await this.$confirm(`确认要删除${name}方案吗？`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      customConfigList.splice(index, 1);

      this.$store.commit("setCustomConfigList", [].concat(customConfigList));
    },
    async setConfigDefaultType(configDefaultType) {
      const res = await this.$confirm(
        `确认要设置当前方案为${configDefaultType}吗？继续操作将替换现有的${configDefaultType}方案`,
        "提示",
        {
          confirmButtonText: "确定",
          cancelButtonText: "取消",
          type: "warning"
        }
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      const customConfigList = [].concat(this.$store.state.customConfigList);
      customConfigList.forEach(v => {
        if (v.name === this.$store.state.config.customConfig) {
          v.configDefaultType = configDefaultType;
        } else if (v.configDefaultType === configDefaultType) {
          v.configDefaultType = "";
        }
      });
      this.$store.commit("setCustomConfigList", customConfigList);
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
  margin: -16px;
  margin-bottom: -13px;
  text-align: left;
  padding: 24px;
  padding-top: calc(24px + constant(safe-area-inset-top));
  padding-top: calc(24px + env(safe-area-inset-top));

  .settings-title {
    font-size: 18px;
    line-height: 22px;
    margin-bottom: 28px;
    font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
    font-weight: 400;

    .title-btn {
      float: right;
      font-size: 14px;
      color: #ed4259;
      cursor: pointer;
    }
  }

  .setting-list {
    max-height: 45vh;
    overflow-y: auto;
    ul {
      list-style: none outside none;
      margin: 0;
      padding: 0;

      li:not(:first-child) {
        margin-top: 20px;
      }

      li {
        list-style: none outside none;

        .setting-item-title {
          display: inline-block;
          width: 56px;
          margin-right: 16px;
          vertical-align: top;
          line-height: 36px;
          color: #666;
        }
        .font-color-title {
          line-height: 40px;
        }
        .selection-zone {
          display: inline-block;
          width: calc(100% - 72px);
          word-wrap: break-word;

          span {
            margin-bottom: 5px;
          }
        }

        .span-item {
          width: 78px;
          height: 34px;
          cursor: pointer;
          margin-right: 16px;
          border-radius: 2px;
          text-align: center;
          vertical-align: middle;
          display: inline-block;
          font: 14px / 34px PingFangSC-Regular, HelveticaNeue-Light, 'Helvetica Neue Light', 'Microsoft YaHei', sans-serif;
          position: relative;

          .delete-custom-config-icon {
            display: inline-block;
            cursor: pointer;
            position: absolute;
            top: -10px;
            right: -10px;
            font-size: 20px;
            color: #ed4259;
            z-index: 10;
          }
        }

        .span-item.selected  {
          border: 1px solid #ed4259;
          color: #ed4259;
        }

        .custom-theme {
          width: calc(100% - 72px);
          display: inline-block;

          .custom-theme-title {
            display: inline-block;
            margin-right: 28px;
            margin-bottom: 5px;
          }

          .content-bg-preview {
            width: 36px;
            height: 36px;
            display: inline-block;
            vertical-align: middle;
            margin-left: 10px;
            margin-bottom: 8px;
            position: relative;
            box-sizing: border-box;

            img {
              width: 100%;
              height: 100%;
              display: inline-block;
              vertical-align: middle;
            }

            .delete-bg-icon {
              position: absolute;
              top: -6px;
              right: -6px;
              font-size: 18px;
              color: #ed4259;
            }
          }
          .selected {
            color: #ed4259;
            border: 1px solid #ed4259;
          }
          .upload-bg-btn {
            display: inline-block;
            margin-left: 10px;
            color: #ed4259;
            cursor: pointer;
          }
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

      li {

        .resize {
          display: inline-block;
          height: 34px;
          vertical-align: middle;
          border-radius: 2px;

          span {
            min-width: 72px;
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

          .lang {
            color: #a6a6a6;
            font-weight: 400;
            font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
          }

          b {
            display: inline-block;
            height: 20px;
            vertical-align: middle;
          }
        }
      }

      .operation-zone {
        display: flex;
        flex-direction: row;
        justify-content: space-between;

        .span-btn {
          cursor: pointer;
          color: #ed4259;
        }
      }
    }
  }
  .setting-list::-webkit-scrollbar {
    width: 0 !important;
  }
  .el-color-picker {
    vertical-align: middle;
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

  .span-item {
    border: 1px solid #666;
    background: rgba(45, 45, 45, 0.5);
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

  .span-item {
    background: rgba(255, 255, 255, 0.5);
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  >>>.resize {
    border: 1px solid #e5e5e5;
    background: rgba(255, 255, 255, 0.5);

    b {
      border-right: 1px solid #e5e5e5;
    }
  }
}

@media (hover: hover) {
  .span-item:hover {
    border: 1px solid #ed4259;
    color: #ed4259;
  }
  li {
    .less:hover, .more:hover {
      color: #ed4259;
    }
  }
}
</style>
