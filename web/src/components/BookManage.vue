<template>
  <el-dialog
    title="书架管理"
    :visible.sync="show"
    :width="dialogWidth"
    :top="dialogTop"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    v-if="$store.getters.isNormalPage"
    :before-close="cancel"
  >
    <div class="custom-dialog-title" slot="title">
      <span class="el-dialog__title"
        >书架管理
        <span class="float-right small-tip">❗️只能缓存文本内容</span>
      </span>
    </div>
    <div class="source-container table-container">
      <el-table
        :data="bookList"
        :height="dialogContentHeight"
        @selection-change="manageBookSelection = $event"
      >
        <el-table-column
          type="selection"
          width="25"
          :selectable="isBookSelectable"
          :fixed="$store.state.miniInterface"
        >
        </el-table-column>
        <el-table-column
          property="name"
          label="书名名"
          min-width="100"
          :fixed="$store.state.miniInterface"
        >
          <template slot-scope="scope">
            <el-button
              class="text-button"
              size="medium"
              type="text"
              @click="showBookInfo(scope.row)"
              >{{ scope.row.name }}</el-button
            >
          </template>
        </el-table-column>
        <el-table-column
          property="author"
          label="作者"
          min-width="100"
        ></el-table-column>
        <el-table-column label="分组" min-width="120">
          <template slot-scope="scope">
            {{ renderBookGroup(scope.row) }}
          </template>
        </el-table-column>
        <el-table-column label="章节" min-width="120">
          <template slot-scope="scope">
            <span>共 {{ scope.row.totalChapterNum }} 章</span><br />
            <span v-if="scope.row.origin !== 'loc_book'">
              服务器缓存： {{ scope.row.cachedChapterCount || 0 }} 章 <br
            /></span>
            <span>浏览器缓存： {{ scope.row.localCacheCount }} 章</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100px">
          <template slot-scope="scope">
            <el-button
              class="text-button"
              size="medium"
              type="text"
              @click="editBook(scope.row)"
              >编辑</el-button
            >
            <el-button
              class="text-button"
              size="medium"
              type="text"
              style="margin-left: 0"
              @click="setBookGroup(scope.row)"
              >分组</el-button
            >
            <el-dropdown @command="cacheBook(scope.row, $event)">
              <el-button class="text-button" type="text" size="medium">
                <span v-if="isCaching(scope.row)">
                  <i class="el-icon-loading"></i> 缓存中
                </span>
                <span v-else>
                  缓存<i class="el-icon-arrow-down el-icon--right"></i>
                </span>
              </el-button>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item
                  v-if="scope.row.origin !== 'loc_book'"
                  command="cacheBookSSE"
                  >缓存到服务器</el-dropdown-item
                >
                <el-dropdown-item command="cacheBookLocal"
                  >缓存到浏览器</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="scope.row.origin !== 'loc_book'"
                  command="deleteBookCache"
                  >删除服务器缓存</el-dropdown-item
                >
                <el-dropdown-item command="deleteBookLocalCache"
                  >删除浏览器缓存</el-dropdown-item
                >
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="exportBook(scope.row, $event)">
              <el-button class="text-button" type="text" size="medium">
                导出<i class="el-icon-arrow-down el-icon--right"></i>
              </el-button>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="txt">导出为TXT</el-dropdown-item>
                <el-dropdown-item command="epub">导出为Epub</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div slot="footer" class="dialog-footer">
      <el-button
        type="primary"
        size="medium"
        class="float-left"
        @click="deleteBookList"
        >批量删除</el-button
      >
      <el-dropdown class="float-left" @command="addBookGroupMulti">
        <el-button type="primary" size="medium">
          批量添加分组<i class="el-icon-arrow-down el-icon--right"></i>
        </el-button>
        <el-dropdown-menu slot="dropdown">
          <el-dropdown-item
            v-for="(bookGroup, index) in bookGroupList"
            :key="'bookGroup-' + index"
            :command="bookGroup"
            >{{ bookGroup.groupName }}</el-dropdown-item
          >
        </el-dropdown-menu>
      </el-dropdown>
      <el-dropdown class="float-left" @command="removeBookGroupMulti">
        <el-button type="primary" size="medium">
          批量移除分组<i class="el-icon-arrow-down el-icon--right"></i>
        </el-button>
        <el-dropdown-menu slot="dropdown">
          <el-dropdown-item
            v-for="(bookGroup, index) in bookGroupList"
            :key="'bookGroup-' + index"
            :command="bookGroup"
            >{{ bookGroup.groupName }}</el-dropdown-item
          >
        </el-dropdown-menu>
      </el-dropdown>
      <span class="check-tip">已选择 {{ manageBookSelection.length }} 个</span>
      <el-button size="medium" @click="cancel">取消</el-button>
    </div>
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";
import Axios from "../plugins/axios";
import eventBus from "../plugins/eventBus";
const buildURL = require("axios/lib/helpers/buildURL");
import { LimitResquest } from "../plugins/helper";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "BookManage",
  data() {
    return {
      bookList: [],
      manageBookSelection: []
    };
  },
  props: ["show"],
  computed: {
    ...mapGetters(["dialogWidth", "dialogTop", "dialogContentHeight"]),
    bookGroupList() {
      return this.$store.state.bookGroupList.filter(v => v.groupId > 0);
    },
    cachingBookList: {
      get() {
        return this.$store.state.cachingBookList;
      },
      set(val) {
        this.$store.commit("setCachingBookList", val);
      }
    },
    cachingBookMap() {
      const map = {};
      this.cachingBookList.map(v => {
        map[v.bookUrl] = true;
      });
      return map;
    }
  },
  created() {
    window.cacheEventSource = window.cacheEventSource || {};
    window.cacheRequestHandle = window.cacheRequestHandle || {};
    window.bookManageComp = this;
  },
  watch: {
    show(isVisible) {
      if (isVisible) {
        this.loadBookCacheInfo();
      } else {
        this.manageBookSelection = [];
      }
    }
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    },
    formatTableField(row, column, cellValue) {
      switch (column.property) {
        default:
          return cellValue;
      }
    },
    isBookSelectable() {
      return true;
    },
    async loadBookCacheInfo() {
      return Axios.get(this.api + "/getShelfBookWithCacheInfo").then(
        res => {
          if (res.data.isSuccess) {
            this.computeCachedCata(res.data.data).then(v => {
              this.bookList = v;
            });
          }
        },
        error => {
          this.$message.error(
            "获取书架信息失败 " + (error && error.toString())
          );
        }
      );
    },
    async deleteBookList() {
      if (!this.manageBookSelection.length) {
        this.$message.error("请选择需要删除的书籍");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的书籍吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteBooks", this.manageBookSelection).then(
        res => {
          if (res.data.isSuccess) {
            this.manageBookSelection = [];
            this.$message.success("删除书籍成功");
            this.loadBookCacheInfo();
            this.$root.$children[0].loadBookShelf();
          }
        },
        error => {
          this.$message.error("删除书籍失败 " + (error && error.toString()));
        }
      );
    },
    async addBookGroupMulti(bookGroup) {
      return this.operateBookGroupMulti(bookGroup, true);
    },
    async removeBookGroupMulti(bookGroup) {
      return this.operateBookGroupMulti(bookGroup);
    },
    async operateBookGroupMulti(bookGroup, isAdd) {
      const operate = isAdd ? "添加" : "移除";
      if (!this.manageBookSelection.length) {
        this.$message.error("请选择需要" + operate + "分组的书籍");
        return;
      }
      const res = await this.$confirm(
        isAdd
          ? `确认要将所选择的书籍添加到${bookGroup.groupName}分组吗?`
          : `确认要将所选择的书籍从${bookGroup.groupName}分组中移除吗?`,
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
      Axios.post(
        this.api + (isAdd ? "/addBookGroupMulti" : "/removeBookGroupMulti"),
        {
          groupId: bookGroup.groupId,
          bookList: this.manageBookSelection
        }
      ).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("操作成功");
            this.loadBookCacheInfo();
            this.$root.$children[0].loadBookShelf();
          }
        },
        error => {
          this.$message.error("操作失败 " + (error && error.toString()));
        }
      );
    },
    renderBookGroup(book) {
      const groups = [];
      this.$store.state.bookGroupList.forEach(v => {
        if (v.groupId > 0 && (v.groupId & book.group) !== 0) {
          groups.push(v.groupName);
        }
      });
      return groups.join(" ");
    },
    showBookInfo(book) {
      eventBus.$emit("showBookInfoDialog", book);
    },
    editBook(book) {
      eventBus.$emit("editBook", book, false, () => {
        this.loadBookCacheInfo();
      });
    },
    setBookGroup(book) {
      this.$store.commit("setShowBookInfo", book);
      eventBus.$emit("showBookGroupDialog", true);
    },
    isCaching(book) {
      if (this.cachingBookMap[book.bookUrl]) return true;
      if (window.cacheEventSource && window.cacheEventSource[book.bookUrl])
        return true;
      if (window.cacheRequestHandle && window.cacheRequestHandle[book.bookUrl])
        return true;
      return false;
    },
    cacheBook(book, command) {
      this[command](book);
    },
    async cacheBookSSE(book) {
      const tryClose = () => {
        try {
          if (
            window.cacheEventSource[book.bookUrl] &&
            window.cacheEventSource[book.bookUrl].readyState !=
              window.cacheEventSource[book.bookUrl].CLOSED
          ) {
            window.cacheEventSource[book.bookUrl].close();
          }
          window.cacheEventSource[book.bookUrl] = null;
          delete window.cacheEventSource[book.bookUrl];
          const index = this.cachingBookList.findIndex(
            v => v.bookUrl === book.bookUrl
          );
          this.cachingBookList.splice(index, 1);
          this.cachingBookList = [].concat(this.cachingBookList);
        } catch (error) {
          //
        }
      };
      if (this.isCaching(book)) {
        // 取消缓存
        this.$message.info("已取消缓存");
        if (window.cacheEventSource[book.bookUrl]) {
          tryClose();
        }
        return;
      }

      const params = {
        url: book.bookUrl,
        refresh: 0
      };

      const url = buildURL(this.api + "/cacheBookSSE", params);

      tryClose();

      this.cachingBookList = this.cachingBookList.concat([book]);
      window.cacheEventSource[book.bookUrl] = new EventSource(url, {
        withCredentials: true
      });
      window.cacheEventSource[book.bookUrl].addEventListener("error", e => {
        tryClose();
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.errorMsg) {
              this.$message.error(result.errorMsg);
            }
          }
        } catch (error) {
          //
        }
      });
      window.cacheEventSource[book.bookUrl].addEventListener("end", e => {
        this.$message.info(book.name + "缓存到服务器完成");
        tryClose();
        try {
          if (e.data) {
            // const result = JSON.parse(e.data);
            // console.log(result);
          }
        } catch (error) {
          //
        }
      });
      window.cacheEventSource[book.bookUrl].addEventListener("message", e => {
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.cachedCount) {
              const index = this.bookList.findIndex(
                v => v.bookUrl === book.bookUrl
              );
              this.$set(this.bookList, index, {
                ...book,
                cachedChapterCount: result.cachedCount
              });
            }
          }
        } catch (error) {
          //
        }
      });
    },
    cacheBookLocal(book) {
      if (this.isCaching(book)) {
        // 取消缓存
        this.$message.info("已取消缓存");
        if (window.cacheRequestHandle[book.bookUrl]) {
          window.cacheRequestHandle[book.bookUrl].cancel();
        }
        return;
      }
      let isComputing = false;
      const computeCache = () => {
        this.computeCachedCata([book]).then(bookList => {
          isComputing = false;
          const index = this.bookList.findIndex(
            v => v.bookUrl === book.bookUrl
          );
          this.$set(this.bookList, index, {
            ...book,
            localCacheCount: bookList[0].localCacheCount
          });
        });
      };
      this.cachingHandler = LimitResquest(2, handler => {
        if (!isComputing) {
          isComputing = true;
          computeCache();
        }
        if (handler.isEnd()) {
          this.$message.success("缓存到浏览器完成");
          computeCache();
        }
      });
      for (let i = 0; i < book.totalChapterNum; i++) {
        this.cachingHandler(() => {
          return this.$root.$children[0].getBookContent(
            i,
            {
              timeout: 30000,
              silent: true
            },
            false,
            true,
            book
          );
        });
      }
    },
    exportBook(book, type) {
      const url = buildURL(this.api + "/exportBook", {
        url: book.bookUrl,
        isEpub: type === "epub" ? 1 : 0
      });

      window.open(url, "_target");
    },
    computeCachedCata(bookList, returnCacheMap) {
      const cachePrefixMap = {};
      bookList.forEach(book => {
        cachePrefixMap[book.bookUrl] = {
          key:
            "localCache@" +
            book.name +
            "_" +
            book.author +
            "@" +
            book.bookUrl +
            "@chapterContent-",
          map: {}
        };
      });
      return window.$cacheStorage
        .iterate(function(value, key) {
          for (const bookUrl in cachePrefixMap) {
            if (key.startsWith(cachePrefixMap[bookUrl].key)) {
              try {
                let index = parseInt(
                  key.replace(cachePrefixMap[bookUrl].key, "")
                );
                cachePrefixMap[bookUrl].map[index] = true;
              } catch (error) {
                //
                // console.error(error);
              }
              break;
            }
          }
        })
        .then(() => {
          if (returnCacheMap) return cachePrefixMap;
          return bookList.map(v => {
            const cacheMap = cachePrefixMap[v.bookUrl].map;
            v.localCacheCount = Object.keys(cacheMap).length;
            return v;
          });
        })
        .catch(function() {
          if (returnCacheMap) return cachePrefixMap;
          return bookList.map(v => {
            v.localCacheCount = 0;
            return v;
          });
        });
    },
    async deleteBookCache(book) {
      const res = await this.$confirm(
        `确认要删除服务器上《${book.name}》的缓存章节吗?`,
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
      Axios.post(this.api + "/deleteBookCache", {
        bookUrl: book.bookUrl
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除服务器缓存成功");
            this.loadBookCacheInfo();
          }
        },
        error => {
          this.$message.error(
            "删除服务器缓存失败 " + (error && error.toString())
          );
        }
      );
    },
    async deleteBookLocalCache(book) {
      const res = await this.$confirm(
        `确认要删除浏览器中《${book.name}》的缓存章节吗?`,
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
      this.computeCachedCata([book], true)
        .then(list => {
          const op = [];
          for (const index in list[book.bookUrl].map) {
            const cacheKey = list[book.bookUrl].key + index;
            op.push(window.$cacheStorage.removeItem(cacheKey));
          }
          return Promise.all(op);
        })
        .then(() => {
          this.$message.success("删除浏览器缓存成功");
          this.computeCachedCata([].concat(this.bookList)).then(v => {
            this.bookList = v;
          });
        });
    }
  }
};
</script>
<style lang="stylus" scoped>
.float-right {
  float: right;
}
.small-tip {
  font-size: 14px;
  margin-right: 10px;
}
.dialog-footer {
  .float-left {
    margin-right: 5px;
  }
}
.source-container {
  .text-button {
    padding: 3px 5px;
  }
}
</style>
