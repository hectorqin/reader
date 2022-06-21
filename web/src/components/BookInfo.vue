<template>
  <el-dialog
    title="书籍信息"
    :visible.sync="show"
    :width="dialogSmallWidth"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    :before-close="cancel"
  >
    <div class="book-info-container" v-if="show">
      <div class="book-cover">
        <div class="book-cover-bg" :style="bookCoverBgStyle"></div>
        <div class="book-cover-bg-image">
          <img
            v-lazy="getCover(getBookCoverUrl(showBookInfo))"
            :key="showBookInfo.name"
            alt=""
            @click="triggerBookCoverRefClick"
          />
          <input
            ref="bookCoverRef"
            type="file"
            accept="image/jpg, image/png, image/jpeg"
            @change="onCoverFileChange"
            style="display:none"
          />
        </div>
      </div>
      <div class="book-name">{{ showBookInfo.name }}</div>
      <div class="book-kind" v-html="renderBookKind(showBookInfo.kind)"></div>
      <div class="book-props">
        <div class="book-prop book-author">
          作者： {{ showBookInfo.author || "未知" }}
        </div>
        <div class="book-prop book-origin">
          来源： {{ displayOriginName(showBookInfo.origin) }}
          <el-button
            type="text"
            class="book-prop-btn"
            v-if="showBookInfo.origin === 'loc_book'"
            @click="refreshLocalBook(showBookInfo)"
            >更新</el-button
          >
        </div>
        <div class="book-prop book-latest">
          <span class="latest-title"
            >最新： {{ showBookInfo.latestChapterTitle }}
          </span>
          <span class="book-prop-btn" v-if="isInShelf">
            追更
            <el-switch
              v-model="showBookInfo.canUpdate"
              active-color="#13ce66"
              inactive-color="#ff4949"
              :active-value="true"
              :inactive-value="false"
              @change="toggleBookCanUpdate(book)"
            >
            </el-switch>
          </span>
        </div>
        <div class="book-prop book-group" v-if="isInShelf">
          分组： {{ displayGroupName(showBookInfo.group) }}
          <el-button
            type="text"
            class="book-prop-btn"
            @click="showSetBookGroup()"
            >设置分组</el-button
          >
        </div>
        <div class="book-prop book-operate-zone" v-else>
          <el-tag
            type="success"
            :effect="$store.getters.isNight ? 'dark' : 'light'"
            class="book-operate-btn"
            @click.stop="saveBook(showBookInfo, true)"
          >
            加入书架
          </el-tag>
        </div>
      </div>
      <div class="book-intro" v-html="renderBookIntro(showBookInfo)"></div>
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
  name: "BookInfo",
  data() {
    return {};
  },
  props: ["show"],
  computed: {
    ...mapGetters(["dialogSmallWidth", "dialogTop"]),
    bookCoverBgStyle() {
      return {
        backgroundImage: `url(${this.getCover(
          this.getBookCoverUrl(this.showBookInfo),
          true
        )})`
      };
    },
    bookSourceList() {
      return this.$store.state.bookSourceList;
    },
    showBookInfo: {
      get() {
        return this.$store.state.showBookInfo;
      },
      set(val) {
        this.$store.commit("setShowBookInfo", val);
      }
    },
    isInShelf() {
      return this.$store.getters.shelfBooks.find(
        v => v.bookUrl === this.showBookInfo.bookUrl
      );
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
    displayGroupName(value) {
      const groupName = [];
      let unGroupName = "";
      this.$store.state.bookGroupList.forEach(v => {
        if (v.groupId > 0 && (v.groupId & value) !== 0) {
          groupName.push(v.groupName);
        } else if (v.groupId === -4) {
          unGroupName = v.groupName;
        }
      });
      return groupName.join(",") || unGroupName || "未分组";
    },
    displayOriginName(value) {
      if (value === "loc_book") return "本地";
      return (
        (this.bookSourceList.find(v => v.bookSourceUrl === value) || {})
          .bookSourceName || "未知书源"
      );
    },
    renderBookKind(value) {
      if (!value) {
        return "";
      }
      const kindList = value.split(",");
      return kindList
        .filter(v => v)
        .map(v => {
          return `<span>${v}</span>`;
        })
        .join("");
    },
    renderBookIntro(book) {
      const intro = (book.intro || "暂无简介").split("\n");
      return intro
        .map(v => {
          return `<p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${v.replace(
            /^\s+/g,
            ""
          )}</p>`;
        })
        .join("");
    },
    getBookCoverUrl(book) {
      return book.customCoverUrl || book.coverUrl;
    },
    triggerBookCoverRefClick() {
      this.$refs.bookCoverRef.dispatchEvent(new MouseEvent("click"));
    },
    onCoverFileChange(event) {
      if (!event.target || !event.target.files || !event.target.files.length) {
        return;
      }
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      let param = new FormData();
      param.append("file", rawFile);
      param.append("type", "covers");
      Axios.post(this.api + "/uploadFile", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess) {
            if (!res.data.data.length) {
              this.$message.error("上传文件失败");
              return;
            }
            this.showBookInfo.customCoverUrl = res.data.data[0];
            this.saveBook(this.showBookInfo).then(res => {
              this.showBookInfo = res;
            });
          }
        },
        error => {
          this.$message.error("上传文件失败 " + (error && error.toString()));
        }
      );
    },
    refreshLocalBook(book) {
      Axios.post(this.api + "/refreshLocalBook", {
        bookUrl: book.bookUrl
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("更新成功");
            this.showBookInfo = res.data.data;
            this.$store.commit("updateShelfBook", res.data.data);
          }
        },
        error => {
          this.$message.error("更新失败" + (error && error.toString()));
        }
      );
    },
    toggleBookCanUpdate(book) {
      return this.saveBook(book);
    },
    saveBook(book, isAdd) {
      return Axios.post(this.api + "/saveBook", book).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success(isAdd ? "加入书架成功" : "操作成功");
            this.showBookInfo = res.data.data;
            if (isAdd) {
              this.$root.$children[0].loadBookShelf(true);
            } else {
              this.$store.commit("updateShelfBook", res.data.data);
            }
          }
        },
        error => {
          this.$message.error(
            (isAdd ? "加入书架成功" : "操作成功") + (error && error.toString())
          );
        }
      );
    },
    showSetBookGroup() {
      eventBus.$emit("showBookGroupDialog", true);
    }
  }
};
</script>
<style lang="stylus" scoped>
.book-info-container {
  .book-cover {
    width: 100%;
    position: relative;
    height: 150px;

    .book-cover-bg {
      position: absolute;
      height: 100%;
      width: 100%;
      filter: blur(50px);
    }

    .book-cover-bg-image {
      position: absolute;
      height: 100%;
      width: 100%;

      img {
        margin: 0 auto;
        display: block;
        height: 150px;
      }
    }
  }
  .book-name {
    display: block;
    font-size: 16px;
    font-weight: 500;
    text-align: center;
    padding: 10px 0;
  }

  .book-kind {
    display: block;
    color: red;
    text-align: center;
    padding: 5px 0;
  }

  .book-props {
    padding: 5px 0;

    .book-prop {
      padding: 3px 0;

      &.book-latest {
        display: flex;
        flex-direction: row;
        justify-content: space-between;

        .latest-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .book-prop-btn {
          width: 80px;
          text-align: right;
        }
      }

      .book-prop-btn {
        float: right;
        height: 19px;
        padding: 0;
        cursor: pointer;
      }

      &.book-operate-zone {
        text-align: center;

        .book-operate-btn {
          cursor: pointer;
        }
      }
    }
  }

  .book-intro {
    line-height: 1.6;
    max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px - 150px - 75px - 120px);
    overflow-y: auto;
  }
}
</style>
<style lang="stylus">
.night-theme {
  .book-info-container {
    .book-name {
      color: #eee !important;
    }
  }
}
@media screen and (max-width: 750px) {
  .book-info-container {
    .book-intro {
      max-height: calc(var(--vh, 1vh) * 100 - 54px - 60px - 150px - 75px - 120px) !important;
    }
  }
}
</style>
