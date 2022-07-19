<template>
  <el-dialog
    :title="rssSource.sourceName"
    :visible.sync="show"
    :width="dialogSmallWidth"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    :before-close="cancel"
  >
    <el-tabs
      v-if="sortUrls.length > 1"
      v-model="sortName"
      @tab-click="onTabClick"
    >
      <el-tab-pane
        v-for="(sort, index) in sortUrls"
        :label="sort.name"
        :name="sort.name"
        :key="'sort-' + index + sort.name"
      ></el-tab-pane>
    </el-tabs>
    <div class="rss-article-list-container" ref="rssArticleListRef">
      <div
        class="rss-article"
        v-for="(article, index) in rssArticleList"
        :key="'rss-article-' + index"
        @click="getRssArticleContent(article)"
      >
        <div class="rss-article-info">
          <div class="rss-article-title">{{ article.title }}</div>
          <div class="rss-article-date">{{ article.pubDate }}</div>
        </div>
        <div class="rss-article-image" v-if="article.image">
          <div class="image-wrapper">
            <el-image
              class="rss-article-img"
              :src="getCover(article.image, true, true)"
              :preview-src-list="rssArticleImageList"
              fit="cover"
              lazy
              @click.stop="noop"
            >
            </el-image>
          </div>
        </div>
      </div>
      <div
        class="load-more-rss"
        @click="hasMoreRssArticles && getRssArticles(page + 1)"
      >
        {{ hasMoreRssArticles ? "加载更多" : "没有更多啦" }}
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";
import eventBus from "../plugins/eventBus";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "RssArticleList",
  data() {
    return {
      rssArticleList: [],
      sourceUrl: "",
      sortUrls: [],
      sortName: "",
      sortUrl: "",
      hasMoreRssArticles: true,
      page: 1
    };
  },
  props: ["show", "rssSource"],
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
        try {
          this.parseSourceUrl();
          this.getRssArticles();
        } catch (error) {
          // console.log(error);
          this.$message.error("解析失败: " + error);
        }
      } else {
        this.sortUrls = [];
        this.rssArticleList = [];
        this.page = 1;
        this.sortName = "";
        this.sortUrl = "";
        this.hasMoreRssArticles = true;
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    parseSourceUrl() {
      this.sourceUrl = this.rssSource.sourceUrl;
      if (!this.rssSource.singleUrl && this.rssSource.sortUrl) {
        // 由于是在客户端解析，所以不支持解析 <js> 和 @js: 开头的 sortUrl
        const sortUrls = [];
        this.rssSource.sortUrl
          .replace(/\r\n/g, "\n")
          .split("\n")
          .forEach(v => {
            if (v) {
              v = v.split("::");
              sortUrls.push({
                name: v[0],
                url: v[1]
              });
            }
          });
        this.sortUrls = sortUrls;
        this.sortName = sortUrls[0].name;
        this.sortUrl = sortUrls[0].url;
      }
    },
    onTabClick(sort) {
      this.sortUrl = this.sortUrls.find(v => v.name === sort.name).url;
      this.page = 1;
      this.hasMoreRssArticles = true;
      this.getRssArticles();
    },
    getRssArticles(page) {
      this.page = page || 1;
      Axios.post(this.api + "/getRssArticles", {
        sourceUrl: this.sourceUrl,
        sortName: this.sortName,
        sortUrl: this.sortUrl,
        page: this.page
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            const articles = res.data.data.first;
            // const nextPageUrl = res.data.data.second;
            if (!articles.length) {
              this.$message.error("没有数据");
              this.hasMoreRssArticles = false;
              return;
            }
            if (this.page > 1) {
              this.rssArticleList = []
                .concat(this.rssArticleList)
                .concat(articles);
            } else {
              this.rssArticleList = articles;
            }
          }
        },
        error => {
          this.$message.error(
            "加载RSS文章列表失败 " + (error && error.toString())
          );
        }
      );
    },
    noop() {},
    showRssArticle() {},
    getRssArticleContent(article) {
      Axios.post(this.api + "/getRssContent", {
        sourceUrl: this.rssSource.sourceUrl,
        link: article.link,
        origin: article.origin
      }).then(
        res => {
          if (res.data.isSuccess) {
            eventBus.$emit("showRssArticleDialog", {
              ...article,
              content: res.data.data
            });
          }
        },
        error => {
          this.$message.error(
            "加载RSS文章内容失败 " + (error && error.toString())
          );
        }
      );
    }
  }
};
</script>
<style lang="stylus" scoped>
.rss-article-list-container {
  max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px);
  overflow-y: auto;

  .rss-article {
    display: flex;
    flex-direction: row;
    padding: 15px 10px;
    border-bottom: 1px solid #eee;
    cursor: pointer;

    .rss-article-info {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      flex: 1;
      padding-right: 5px;

      .rss-article-title {
        font-weight: 600;
        font-size: 14px;
      }

      .rss-article-date {
        font-size: 12px;
        margin-top: 10px;
      }
    }
    .rss-article-image {
      width: 120px;
      display: flex;
      align-items: center;

      .image-wrapper {
        width: 100%;
        height: 0;
        padding-bottom: 62.5%;
        overflow: hidden;

        .rss-article-img {
          width: 120px;
          height: 75px;
        }
      }
    }
  }

  .load-more-rss {
    text-align: center;
    padding: 10px;
    cursor: pointer;
  }
}
</style>
<style lang="stylus">
.night-theme {
  .rss-article-list-container {
    .rss-article {
      border-color: #333;
      color: #aaa;

      .rss-article-date {
        color: #666;
      }
    }
  }
}
@media screen and (max-width: 750px) {
  .rss-article-list-container {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px) !important;

    .rss-article {
      padding: 15px 5px;

      .rss-article-image {
        width: 100px;
        .rss-article-img {
          width: 100px;
          height: 62.5px;
        }
      }
    }
  }
}
</style>
