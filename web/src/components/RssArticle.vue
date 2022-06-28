<template>
  <el-dialog
    :title="rssArticleInfo.title"
    :visible.sync="show"
    :width="dialogSmallWidth"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    :before-close="cancel"
  >
    <div class="rss-article-info-container" v-if="show">
      <div
        class="rss-article-content"
        ref="rssArticleContentRef"
        v-html="rssArticleInfo.content || rssArticleInfo.description"
        @click="rssArticleClickHandler"
      ></div>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "RssArticle",
  data() {
    return {
      rssArticleList: [],
      sourceUrl: "",
      sortUrls: [],
      sortName: "",
      hasMoreRssArticles: true,
      page: 1
    };
  },
  props: ["show", "rssArticleInfo"],
  computed: {
    ...mapGetters(["dialogSmallWidth", "dialogTop"]),
    rssArticleImageList() {
      return this.rssArticleList
        .filter(v => v.image)
        .map(v => this.getImage(v.image, true, true));
    }
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        //
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    rssArticleClickHandler(e) {
      if (
        e.target &&
        e.target.nodeName &&
        e.target.nodeName.toLowerCase() === "img"
      ) {
        const imgList = this.$refs.rssArticleContentRef.querySelectorAll("img");
        if (imgList.length) {
          const imgUrlList = [];
          let index = 0;
          for (let i = 0; i < imgList.length; i++) {
            imgUrlList.push(imgList[i].src);
            if (imgList[i] === e.target) {
              index = i;
            }
          }
          this.$store.commit("setPreviewImageIndex", index);
          this.$store.commit("setPreviewImgList", imgUrlList);
        }
      }
    }
  }
};
</script>
<style lang="stylus" scoped>
.rss-article-info-container {
  max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px);
  overflow-y: auto;
}
</style>
<style lang="stylus">
.night-theme {
  .rss-article-content {
    color: #aaa;
  }
}
@media screen and (max-width: 750px) {
  .rss-article-info-container {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px) !important;
  }
}
.rss-article-info-container img {
  max-width: 100%;
}
.rss-article-info-container video {
  max-width: 100%;
}
</style>
