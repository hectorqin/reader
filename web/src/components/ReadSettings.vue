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
              :class="{ selected: config.pageType == type }"
              @click="setPageType(type)"
              >{{ type === "Kindle" ? "简洁" : "正常" }}</span
            >
            <span class="small-tip"
              >❗️开启简洁模式会关闭动画以及首页的部分功能</span
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
              @click="setConfig('theme', index)"
              :class="{ selected: config.theme === index }"
              ><em v-if="index != 6" class="iconfont">&#58980;</em
              ><em v-else class="moon-icon">{{ moonIcon }}</em></span
            >
            <span
              class="span-item"
              :key="'custom'"
              ref="themes"
              @click="setConfig('theme', 'custom')"
              :class="{ selected: config.theme === 'custom' }"
              >自定义</span
            >
          </div>
        </li>
        <li v-if="config.theme === 'custom'">
          <span class="setting-item-title">自定义</span>
          <div class="custom-theme">
            <div class="custom-theme-title">
              <span class="custom-theme-title">主题模式</span>
              <span
                class="span-item"
                v-for="(type, index) in themeTypes"
                :key="index"
                :class="{ selected: themeType == type }"
                @click="setConfig('themeType', type)"
                >{{ type === "day" ? "白天" : "黑夜" }}</span
              >
            </div>
            <span class="custom-theme-title"
              >页面背景颜色
              <el-color-picker v-model="config.bodyColor"></el-color-picker>
            </span>
            <span class="custom-theme-title"
              >浮窗背景颜色
              <el-color-picker v-model="config.popupColor"></el-color-picker
            ></span>
            <span class="custom-theme-title"
              >阅读背景颜色
              <el-color-picker v-model="config.contentColor"></el-color-picker
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
              :class="{ selected: config.font == index }"
              @click="setConfig('font', index)"
              >{{ font }}
              <i
                :class="{
                  'el-icon-upload': true,
                  'upload-font-icon': true,
                  active:
                    config.customFontsMap &&
                    config.customFontsMap[customFonts[index]]
                }"
                @click.stop="uploadFontFile(customFonts[index], font)"
              ></i>
            </span>
            <input
              ref="fontFileRef"
              type="file"
              @change="onFontFileChange"
              style="display:none"
            />
          </div>
        </li>
        <li>
          <span class="setting-item-title">简繁转换</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(chineseFont, index) in chineseFonts"
              :key="index"
              :class="{ selected: config.chineseFont == chineseFont }"
              @click="setConfig('chineseFont', chineseFont)"
              >{{ chineseFont }}</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">字体大小</span>
          <div class="resize">
            <span class="less" @click="decConfig('fontSize')"
              ><em class="iconfont">&#58966;</em></span
            ><b></b>
            <span class="lang">
              <el-input
                class="setting-input"
                v-model="config.fontSize"
                size="mini"
              ></el-input></span
            ><b></b>
            <span class="more" @click="incConfig('fontSize')"
              ><em class="iconfont">&#58976;</em></span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">字体粗细</span>
          <div class="resize">
            <span class="less" @click="decConfig('fontWeight')"
              ><i class="el-icon-minus"></i></span
            ><b></b>
            <span class="lang">
              <el-input
                class="setting-input"
                v-model="config.fontWeight"
                size="mini"
              ></el-input></span
            ><b></b>
            <span class="less" @click="incConfig('fontWeight')"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">段落行高</span>
          <div class="resize">
            <span class="less" @click="decConfig('lineHeight')"
              ><i class="el-icon-minus"></i></span
            ><b></b>
            <span class="lang">
              <el-input
                class="setting-input"
                v-model="config.lineHeight"
                size="mini"
              ></el-input></span
            ><b></b>
            <span class="less" @click="incConfig('lineHeight')"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">段落间距</span>
          <div class="resize">
            <span class="less" @click="decConfig('paragraphSpace')"
              ><i class="el-icon-minus"></i></span
            ><b></b>
            <span class="lang">
              <el-input
                class="setting-input"
                v-model="config.paragraphSpace"
                size="mini"
              ></el-input></span
            ><b></b>
            <span class="less" @click="incConfig('paragraphSpace')"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title font-color-title">字体颜色</span>
          <el-color-picker v-model="config.fontColor"></el-color-picker>
        </li>
        <li>
          <span class="setting-item-title">页面模式</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(mode, index) in pageModes"
              :key="index"
              :class="{ selected: config.pageMode == mode }"
              @click="setPageMode(mode)"
              >{{ mode }}</span
            >
          </div>
        </li>
        <li v-if="!$store.state.miniInterface">
          <span class="setting-item-title">页面宽度</span>
          <div class="resize">
            <span class="less" @click="decConfig('readWidth')"
              ><em class="iconfont">&#58965;</em></span
            ><b></b> <span class="lang">{{ config.readWidth }}</span
            ><b></b>
            <span class="more" @click="incConfig('readWidth')"
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
              :class="{ selected: config.readMethod == method }"
              @click="setReadMethod(method)"
              v-show="
                (!$store.state.miniInterface && method !== '左右滑动') ||
                  $store.state.miniInterface
              "
              >{{ method }}</span
            >
            <span class="small-tip"
              >❗️上下滚动2会自动隐藏看过的章节，但是可能会抖动</span
            >
          </div>
        </li>
        <li>
          <span class="setting-item-title">动画时长</span>
          <div class="resize">
            <span class="less" @click="decConfig('animateMSTime')"
              ><i class="el-icon-minus"></i></span
            ><b></b>
            <span class="lang">
              <el-input
                class="setting-input"
                v-model="config.animateMSTime"
                size="mini"
              ></el-input></span
            ><b></b>
            <span class="less" @click="incConfig('animateMSTime')"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">自动翻页</span>
          <div class="selection-zone">
            <span
              class="span-item"
              v-for="(method, index) in autoReadingMethods"
              :key="index"
              :class="{ selected: config.autoReadingMethod === method }"
              @click="setConfig('autoReadingMethod', method)"
              >{{ method }}</span
            >
          </div>
        </li>
        <li v-if="config.autoReadingMethod === '像素滚动'">
          <span class="setting-item-title">滚动像素</span>
          <div class="resize">
            <span class="less" @click="decConfig('autoReadingPixel')"
              ><i class="el-icon-minus"></i></span
            ><b></b>
            <span class="lang">
              <el-input
                class="setting-input"
                v-model="config.autoReadingPixel"
                size="mini"
              ></el-input> </span
            ><b></b>
            <span class="less" @click="incConfig('autoReadingPixel')"
              ><i class="el-icon-plus"></i
            ></span>
          </div>
        </li>
        <li>
          <span class="setting-item-title">翻页速度</span>
          <div class="resize">
            <span class="less" @click="decConfig('autoReadingLineTime')"
              ><i class="el-icon-minus"></i></span
            ><b></b>
            <span class="lang"
              ><el-input
                class="setting-input"
                v-model="config.autoReadingLineTime"
                size="mini"
              ></el-input></span
            ><b></b>
            <span class="less" @click="incConfig('autoReadingLineTime')"
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
              :class="{ selected: config.clickMethod == method }"
              @click="setConfig('clickMethod', method)"
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
              :class="{ selected: config.selectionAction == action }"
              @click="setConfig('selectionAction', action)"
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
import Axios from "../plugins/axios";
import settings from "../plugins/config";
import eventBus from "../plugins/eventBus";
import { isMiniInterface, removeFont } from "../plugins/helper";
import { setCache, getCache } from "../plugins/cache";
import { customFonts } from "../plugins/config";

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
      readMethods: ["上下滑动", "左右滑动", "上下滚动", "上下滚动2"],
      clickMethods: ["下一页", "自动", "不翻页"],
      selectionActions: ["操作弹窗", "忽略"],
      pageModes: ["自适应", "手机模式"],
      pageTypes: ["正常", "Kindle"],
      themeTypes: ["day", "night"],
      configDefaultTypeList: ["白天默认", "黑夜默认"],
      autoReadingMethods: ["像素滚动", "段落滚动"],
      chineseFonts: ["简体", "繁体"],

      customFontName: "",
      customFonts: customFonts,

      config: this.$store.state.config,

      configRules: {
        fontSize: { min: 8, delta: 1 },
        fontWeight: { min: 100, max: 900, delta: 100 },
        animateMSTime: { min: 0, max: 500, delta: 50 },
        autoReadingPixel: { min: 1, delta: 5 },
        autoReadingLineTime: { min: 10, delta: 50 },
        lineHeight: { min: 1, max: 5, delta: 0.2 },
        paragraphSpace: { min: 0, max: 5, delta: 0.2 },
        readWidth: {
          min: Math.min(Math.floor(window.innerWidth / 160), 4) * 160,
          max: Math.floor(window.innerWidth / 160) * 160,
          delta: 160
        }
      }
    };
  },
  mounted() {
    this.config = {
      ...settings.config,
      ...this.config,
      selectionAction:
        this.$store.state.config.selectionAction === "过滤弹窗"
          ? "操作弹窗"
          : "忽略"
    };
  },
  computed: {
    moonIcon() {
      return this.$store.getters.isSystemNight ? "" : "";
    },
    popupTheme() {
      return {
        background: this.$store.getters.currentThemeConfig.popup
      };
    },
    currentCustomConfig() {
      return this.$store.state.customConfigList.find(
        v => v.name === this.$store.state.config.customConfig
      );
    }
  },
  watch: {
    config: {
      deep: true,
      handler(val) {
        this.$store.commit("setConfig", { ...val });
      }
    }
  },
  methods: {
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

      this.config = { ...this.config, ...(lastConfig || {}), pageType: type };

      this.$emit("readMethodChange");
      this.$emit("pageModeChange");
      if (this.config.pageMode === "手机模式") {
        this.$store.commit("setMiniInterface", true);
      } else {
        this.$store.commit("setMiniInterface", isMiniInterface());
      }
    },
    setPageMode(pageMode) {
      this.$emit("pageModeChange");
      this.config = { ...this.config, pageMode };
      if (this.config.pageMode === "手机模式") {
        this.$store.commit("setMiniInterface", true);
      } else {
        this.$store.commit("setMiniInterface", isMiniInterface());
      }
    },
    setReadMethod(readMethod) {
      this.$emit("readMethodChange");
      this.config = { ...this.config, readMethod };
    },
    setConfig(name, value) {
      const data = {};
      data[name] = value;
      this.config = { ...this.config, ...data };
    },
    setAutoTheme() {
      this.config = { ...this.config, autoTheme: !this.config.autoTheme };
    },
    incConfig(name) {
      const data = {};
      const rule = this.configRules[name];
      const val = +this.config[name];
      data[name] =
        "max" in rule ? Math.min(rule.max, val + rule.delta) : val + rule.delta;
      this.config = {
        ...this.config,
        ...data
      };
    },
    decConfig(name) {
      const data = {};
      const rule = this.configRules[name];
      const val = +this.config[name];
      data[name] =
        "min" in rule ? Math.max(rule.min, val - rule.delta) : val - rule.delta;
      this.config = {
        ...this.config,
        ...data
      };
    },
    getCustomBGImgURL(src) {
      return this.api.replace(/\/reader3\/?/, "") + src;
    },
    setBGImg(src) {
      let config = { ...this.config };
      if (config.contentBGImg === src) {
        delete config.contentBGImg;
      } else {
        config.contentBGImg = src;
      }
      this.config = config;
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
            let config = { ...this.config };
            config.customBGImgList = config.customBGImgList || [];
            if (!config.customBGImgList.includes(res.data.data[0])) {
              config.customBGImgList.push(res.data.data[0]);
            }
            config.contentBGImg = res.data.data[0];
            this.config = config;
          }
        },
        error => {
          this.$message.error("上传文件失败 " + (error && error.toString()));
        }
      );
      this.$refs.bgFileRef.value = null;
    },
    async uploadFontFile(customFontName, fontName) {
      if (
        this.config.customFontsMap &&
        this.config.customFontsMap[customFontName]
      ) {
        const res = await this.$confirm(
          `已上传自定义的${fontName}字体?`,
          "提示",
          {
            confirmButtonText: "继续上传",
            cancelButtonText: "恢复默认",
            type: "warning",
            closeOnClickModal: false,
            closeOnPressEscape: false,
            distinguishCancelAndClose: true
          }
        ).catch(action => {
          return action === "close" ? "close" : false;
        });
        if (res === "close") {
          return;
        }
        if (!res) {
          Axios.post(this.api + "/deleteFile", {
            url: this.config.customFontsMap[customFontName]
          }).then(
            res => {
              if (res.data.isSuccess) {
                let config = { ...this.config };
                delete config.customFontsMap[customFontName];
                this.config = config;
                removeFont(customFontName);
              }
            },
            error => {
              this.$message.error(
                "删除自定义字体文件失败 " + (error && error.toString())
              );
            }
          );
          return;
        }
      }
      this.customFontName = customFontName;
      this.$refs.fontFileRef.dispatchEvent(new MouseEvent("click"));
    },
    onFontFileChange(event) {
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      if (!rawFile.name.toLowerCase().endsWith(".ttf")) {
        this.$message.error("只支持 TTF 字体文件");
        return;
      }
      let param = new FormData();
      param.append("file", rawFile);
      param.append("type", "fonts");
      Axios.post(this.api + "/uploadFile", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess) {
            if (!res.data.data.length) {
              this.$message.error("上传文件失败");
              return;
            }
            let config = { ...this.config };
            config.customFontsMap = config.customFontsMap || {};
            config.customFontsMap[this.customFontName] = res.data.data[0];
            this.config = config;
          }
        },
        error => {
          this.$message.error("上传文件失败 " + (error && error.toString()));
        }
      );
      this.$refs.fontFileRef.value = null;
    },
    deleteCustomBGImg(src) {
      Axios.post(this.api + "/deleteFile", {
        url: src
      }).then(
        res => {
          if (res.data.isSuccess) {
            let config = { ...this.config };
            config.customBGImgList = config.customBGImgList || [];
            var index = config.customBGImgList.indexOf(src);
            if (index != -1) {
              config.customBGImgList.splice(index, 1);
            }
            if (config.contentBGImg === src) {
              config.contentBGImg = this.builtinBG[0].src;
            }
            this.config = config;
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    resetConfig() {
      this.config = { ...settings.config };
    },
    showClickZone() {
      this.$emit("close");
      this.$emit("showClickZone");
    },
    showRuleEditor() {
      this.$emit("close");
      eventBus.$emit("showReplaceRuleDialog");
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
      this.config = {
        ...this.config,
        customConfig: customConfig.name,
        ...customConfig
      };
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

          .upload-font-icon {
            display: inline-block;
            cursor: pointer;
            position: absolute;
            top: -10px;
            right: -10px;
            font-size: 20px;
            z-index: 10;
            color: #606266;

            &.active {
              color: #ed4259;
            }
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
<style lang="stylus">
.setting-input {
  .el-input__inner {
    background: transparent;
    border: none !important;
    text-align: center;
    width: 72px;
    font-size: 14px;
    color: #a6a6a6;
  }
}
</style>
