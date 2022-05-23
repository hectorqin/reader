<template>
  <div
    class="index-wrapper"
    :class="{
      night: isNight,
      day: !isNight
    }"
  >
    <div
      class="navigation-wrapper"
      :class="[
        navigationClass,
        isWebApp && !isNight ? 'status-bar-light-bg' : ''
      ]"
      :style="navigationStyle"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      v-if="$store.getters.isNormalPage"
    >
      <div class="navigation-inner-wrapper">
        <div class="navigation-title">
          阅读
          <span class="version-text" @click="updateForce">{{
            $store.state.version
          }}</span>
        </div>
        <div class="navigation-sub-title">
          清风不识字，何故乱翻书
        </div>
        <div class="search-wrapper">
          <el-input
            size="mini"
            placeholder="搜索书籍"
            v-model="search"
            class="search-input"
            @keyup.enter.native="searchBook(1)"
          >
            <i slot="prefix" class="el-input__icon el-icon-search"></i>
          </el-input>
        </div>
        <div class="setting-wrapper search-setting">
          <div class="setting-title">
            搜索设置
          </div>
          <div class="setting-item">
            <el-select
              size="mini"
              v-model="searchConfig.searchType"
              class="setting-select"
              filterable
              placeholder="请选择搜索方式"
            >
              <el-option
                v-for="(item, index) in searchTypeList"
                :key="'search-type-' + index"
                :label="item.name"
                :value="item.value"
              >
              </el-option>
            </el-select>
          </div>
          <div
            class="setting-item"
            v-show="searchConfig.searchType === 'single'"
          >
            <el-select
              size="mini"
              v-model="searchConfig.bookSourceUrl"
              class="setting-select"
              filterable
              placeholder="请选择搜索书源"
            >
              <el-option
                v-for="(item, index) in bookSourceList"
                :key="'source-' + index"
                :label="item.bookSourceName"
                :value="item.bookSourceUrl"
              >
              </el-option>
            </el-select>
          </div>
          <div
            class="setting-item"
            v-show="searchConfig.searchType !== 'single'"
          >
            <el-select
              size="mini"
              v-model="searchConfig.bookSourceGroup"
              class="setting-select"
              filterable
              placeholder="请选择搜索书源分组"
            >
              <el-option
                v-for="(item, index) in bookSourceGroupList"
                :key="'source-group-' + index"
                :label="item.name + ' (' + item.count + ')'"
                :value="item.value"
              >
              </el-option>
            </el-select>
          </div>
          <div
            class="setting-item"
            v-show="searchConfig.searchType !== 'single'"
          >
            <el-select
              size="mini"
              v-model="searchConfig.concurrentCount"
              class="setting-select"
              filterable
              placeholder="请选择并发线程"
            >
              <el-option
                v-for="(item, index) in concurrentList"
                :key="'source-' + index"
                :label="item + '并发线程'"
                :value="item"
              >
              </el-option>
            </el-select>
          </div>
        </div>
        <div class="recent-wrapper">
          <div class="recent-title">
            最近阅读
          </div>
          <div class="reading-recent">
            <el-tag
              type="warning"
              :effect="isNight ? 'dark' : 'light'"
              class="recent-book"
              @click="toDetail(readingRecent)"
              :class="{ 'no-point': readingRecent.bookUrl == '' }"
            >
              {{ readingRecent.bookName }}
            </el-tag>
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">
            后端设定
          </div>
          <div class="setting-item">
            <el-tag
              :type="connectType"
              :effect="isNight ? 'dark' : 'light'"
              class="setting-connect"
              :class="{ 'no-point': connecting }"
              @click="setIP"
            >
              {{ connectStatus }}
            </el-tag>
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">
            书源设置
          </div>
          <div class="setting-item">
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="showBookSourceManageDialog = true"
            >
              书源管理
            </el-tag>
            <el-popover
              placement="right"
              :width="popupWidth"
              trigger="click"
              :visible-arrow="false"
              v-model="popExploreVisible"
              popper-class="popper-component"
            >
              <Explore
                ref="popExplore"
                class="popup"
                :visible="popExploreVisible"
                :bookSourceList="bookSourceList"
                @showSearchList="showSearchList"
                @close="popExploreVisible = false"
              />
              <el-tag
                type="info"
                :effect="isNight ? 'dark' : 'light'"
                slot="reference"
                ref="exploreBtn"
                class="setting-btn"
                @click="showNavigation = false"
              >
                探索书源
              </el-tag>
            </el-popover>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="uploadBookSource"
            >
              导入书源
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="loadRemoteBookSource"
            >
              远程书源
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="loadBookSource(true)"
            >
              缓存书源
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="showFailureBookSource()"
            >
              失效书源
            </el-tag>
            <input
              ref="fileRef"
              type="file"
              @change="onSourceFileChange"
              style="display:none"
            />
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">
            书架设置
          </div>
          <div class="setting-item">
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="showManageBookGroup"
            >
              分组管理
            </el-tag>
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="importLocalBook"
            >
              导入书籍
            </el-tag>
            <input
              ref="bookRef"
              type="file"
              multiple="multiple"
              @change="onBookFileChange"
              style="display:none"
            />
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="showLocalStoreManageDialog = true"
              v-if="
                !$store.state.isSecureMode ||
                  $store.state.userInfo.enableLocalStore
              "
            >
              浏览书仓
            </el-tag>
          </div>
        </div>

        <div class="setting-wrapper">
          <div class="setting-title">
            用户空间
            <span
              class="right-text"
              v-if="$store.state.isSecureMode && $store.state.userInfo.username"
              @click="logout()"
              >注销</span
            >
          </div>
          <div class="setting-item" v-if="$store.state.showManagerMode">
            <el-select
              size="mini"
              v-model="userNS"
              class="setting-select"
              filterable
              placeholder="请选择用户空间"
            >
              <el-option
                v-for="(item, index) in userList"
                :key="'source-' + index"
                :label="item.username"
                :value="item.userNS"
              >
              </el-option>
            </el-select>
          </div>
          <div class="setting-item">
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="saveUserConfig"
              v-if="localStorageAvaliable"
            >
              备份用户配置
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="restoreUserConfig"
              v-if="localStorageAvaliable"
            >
              同步用户配置
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="loadUserList"
              v-if="$store.state.showManagerMode"
            >
              加载用户空间
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              v-if="$store.state.isManagerMode"
              @click="showUserManageDialog()"
            >
              管理用户空间
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              v-if="$store.state.isManagerMode"
              @click="exitSecureMode"
            >
              退出管理模式
            </el-tag>
          </div>
        </div>
        <div
          class="setting-wrapper"
          v-if="
            !$store.state.isSecureMode || $store.state.userInfo.enableWebdav
          "
        >
          <div class="setting-title">
            WebDAV
          </div>
          <div class="setting-item">
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="showWebdavFile('/')"
            >
              文件管理
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="backupToWebdav"
            >
              保存备份
            </el-tag>
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">
            其它
          </div>
          <div class="setting-item">
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="showMPCode"
            >
              关注公众号【假装大佬】
            </el-tag>
            <el-tag
              type="info"
              :effect="isNight ? 'dark' : 'light'"
              slot="reference"
              class="setting-btn"
              @click="joinTGChannel"
            >
              加入TG频道【假装大佬】
            </el-tag>
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">
            本地缓存
            <span class="right-text">{{ localCacheStats.total }}</span>
          </div>
          <div class="setting-item">
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="clearCache('bookSourceList')"
            >
              清空书源缓存
              <span>{{ localCacheStats.bookSourceList }}</span>
            </el-tag>
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="clearCache('rssSources')"
            >
              清空RSS源缓存
              <span>{{ localCacheStats.rssSources }}</span>
            </el-tag>
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="clearCache('chapterList')"
            >
              清空章节列表缓存
              <span>{{ localCacheStats.chapterList }}</span>
            </el-tag>
            <el-tag
              type="info"
              :effect="$store.getters.isNight ? 'dark' : 'light'"
              class="setting-btn"
              @click="clearCache('chapterContent')"
            >
              清空章节内容缓存
              <span>{{ localCacheStats.chapterContent }}</span>
            </el-tag>
          </div>
        </div>
      </div>
      <div class="bottom-icons">
        <a href="https://github.com/hectorqin/reader" target="_blank">
          <div class="bottom-icon">
            <img
              v-if="isNight"
              :src="require('../assets/imgs/github.png')"
              alt=""
            />
            <img v-else :src="require('../assets/imgs/github2.png')" alt="" />
          </div>
        </a>
        <span
          class="theme-item"
          :style="themeColor"
          ref="themes"
          @click="toogleNight"
        >
          <i class="el-icon-moon" v-if="!isNight"></i>
          <i class="el-icon-sunny" v-else></i>
        </span>
      </div>
    </div>
    <div
      class="shelf-wrapper"
      :class="isWebApp && !isNight ? 'status-bar-light-bg' : ''"
      ref="shelfWrapper"
      @click="showNavigation = false"
    >
      <div class="shelf-title">
        <i
          class="el-icon-menu"
          v-if="$store.getters.isNormalPage && collapseMenu"
          @click.stop="toggleMenu"
        ></i>
        {{ isSearchResult ? (isExploreResult ? "探索" : "搜索") : "书架" }}
        ({{ bookList.length }})
        <div
          class="title-btn"
          v-if="$store.getters.isNormalPage && isSearchResult"
          @click="backToShelf"
        >
          书架
        </div>
        <div
          class="title-btn"
          v-if="$store.getters.isNormalPage && isSearchResult"
          @click="loadMore"
        >
          <i class="el-icon-loading" v-if="loadingMore"></i>
          {{ loadingMore ? "加载中..." : "加载更多" }}
        </div>
        <div
          class="title-btn"
          v-if="$store.getters.isNormalPage && !isSearchResult"
          @click="showBookEditButton = !showBookEditButton"
        >
          {{ showBookEditButton ? "取消" : "编辑" }}
        </div>
        <div class="title-btn" v-if="!isSearchResult" @click="refreshShelf">
          <i class="el-icon-loading" v-if="refreshLoading"></i>
          {{ refreshLoading ? "刷新中..." : "刷新" }}
        </div>
        <div
          class="title-btn"
          v-if="$store.getters.isNormalPage && !isSearchResult"
          @click="showRssDialog"
        >
          RSS
        </div>
        <div
          class="title-btn"
          @click="showExplorePop"
          v-if="
            $store.getters.isNormalPage && !(isSearchResult && !isExploreResult)
          "
        >
          书海
        </div>
      </div>
      <div class="book-group-wrapper" v-if="!isSearchResult">
        <el-tag
          type="info"
          :effect="$store.getters.isNight ? 'dark' : 'light'"
          class="book-group-btn"
          :class="showBookGroup === group.groupId ? 'selected' : ''"
          v-for="group in bookGroupDisplayList"
          :key="'bookGroup-' + group.groupId"
          @click="showBookGroup = group.groupId"
        >
          {{ group.groupName }}
        </el-tag>
        <el-tag
          type="info"
          :effect="$store.getters.isNight ? 'dark' : 'light'"
          class="book-group-btn"
          :key="'bookGroup-manage'"
          v-if="$store.getters.isNormalPage && bookGroupDisplayList.length"
          @click="showManageBookGroup"
        >
          管理
        </el-tag>
      </div>
      <div
        class="books-wrapper"
        ref="bookList"
        @touchstart="handleTouchStart"
        @touchmove="handleTouchMove"
        @touchend="handleTouchEnd"
        @scroll="scrollHandler"
      >
        <div class="wrapper">
          <div
            class="book"
            :style="showNavigation ? { minWidth: '360px !important' } : {}"
            v-for="book in bookList"
            :key="book.bookUrl"
            @click="toDetail(book)"
          >
            <div class="cover-img" @click.stop="showBookInfoDialog(book)">
              <!-- <img class="cover" v-lazy="getCover(book.coverUrl)" alt="" /> -->
              <el-image
                class="cover"
                ref="bookCoverList"
                :src="getCover(getBookCoverUrl(book), true)"
                fit="cover"
                lazy
              >
              </el-image>
            </div>
            <div class="info" @click="toDetail(book)">
              <div class="book-operation">
                <i
                  class="el-icon-close"
                  v-if="!isSearchResult && showBookEditButton"
                  @click.stop="deleteBook(book)"
                ></i>
                <i
                  class="el-icon-edit"
                  v-if="!isSearchResult && showBookEditButton"
                  @click.stop="editBook(book)"
                ></i>
                <i
                  class="el-icon-edit"
                  v-if="isSearchResult"
                  @click.stop="editBook(book, true)"
                ></i>
                <el-badge
                  class="unread-num-badge"
                  :max="99"
                  :value="book.totalChapterNum - 1 - book.durChapterIndex"
                  v-if="
                    !isSearchResult &&
                      !showBookEditButton &&
                      book.totalChapterNum - 1 - book.durChapterIndex > 0
                  "
                />
              </div>
              <div
                class="name"
                slot="reference"
                :class="showBookEditButton ? 'edit' : ''"
              >
                {{ book.name }}
              </div>
              <div class="sub">
                <div class="author">
                  {{ book.author || "" }}
                </div>
                <div class="dot" v-if="book.totalChapterNum">•</div>
                <div class="size" v-if="book.totalChapterNum">
                  共{{ book.totalChapterNum }}章
                </div>
              </div>
              <div
                class="dur-chapter"
                v-if="!isSearchResult && book.durChapterTitle"
              >
                已读：{{ book.durChapterTitle }}
              </div>
              <div class="last-chapter" v-if="book.latestChapterTitle">
                {{
                  book.lastCheckTime ? dateFormat(book.lastCheckTime) : "最新"
                }}：{{ book.latestChapterTitle }}
              </div>
              <div v-if="isSearchResult">
                <el-tag
                  type="success"
                  :effect="isNight ? 'dark' : 'light'"
                  class="setting-connect"
                  @click.stop="saveBook(book)"
                >
                  加入书架
                </el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <el-dialog
      :title="isImportRssSource ? '导入RSS源' : '导入书源'"
      :visible.sync="showImportSourceDialog"
      :width="dialogWidth"
      :top="this.collapseMenu ? '0' : '15vh'"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg' : ''"
      v-if="$store.getters.isNormalPage"
    >
      <div class="source-container source-list-container">
        <el-checkbox-group
          v-model="checkedSourceIndex"
          @change="handleCheckedSourcesChange"
        >
          <el-checkbox
            v-for="(source, index) in importSourceList"
            :label="index"
            :key="index"
            class="source-checkbox"
            >{{ isImportRssSource ? source.sourceName : source.bookSourceName }}
            {{ isImportRssSource ? source.sourceUrl : source.bookSourceUrl }}
            {{ getSourceTag(source) }}</el-checkbox
          >
        </el-checkbox-group>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-checkbox
          :indeterminate="isIndeterminate"
          v-model="checkAll"
          @change="handleCheckAllChange"
          border
          size="medium"
          class="float-left"
          >全选</el-checkbox
        >
        <span class="check-tip">已选择 {{ checkedSourceIndex.length }} 个</span>
        <el-button
          size="medium"
          @click="
            showImportSourceDialog = false;
            checkedSourceIndex = [];
          "
          >取消</el-button
        >
        <el-button size="medium" type="primary" @click="saveSourceList"
          >确定</el-button
        >
      </div>
    </el-dialog>
    <el-dialog
      :visible.sync="showBookSourceManageDialog"
      :width="dialogWidth"
      :top="dialogTop"
      @closed="
        isShowFailureBookSource = false;
        showSourceGroup = '';
      "
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      v-if="$store.getters.isNormalPage"
    >
      <div class="custom-dialog-title" slot="title">
        <span class="el-dialog__title"
          >{{ isShowFailureBookSource ? "失效书源管理" : "书源管理" }}
          <span
            v-if="!isShowFailureBookSource"
            class="float-right span-btn"
            @click="deleteAllBookSource()"
            >清空</span
          >
          <span
            v-if="!isShowFailureBookSource"
            class="float-right span-btn"
            @click="exportBookSource()"
            >导出</span
          >
          <span
            v-if="!isShowFailureBookSource"
            class="float-right span-btn"
            @click="editBookSource(false)"
            >新增</span
          >
        </span>
      </div>
      <div class="source-container table-container">
        <div class="check-form" v-if="isShowFailureBookSource">
          <span class="check-form-label">搜索词：</span>
          <el-input v-model="checkBookSourceConfig.keyword" size="small">
          </el-input>
          <span class="check-form-label" style="min-width: 68px;">
            超时(ms)：
          </span>
          <el-input-number
            v-model="checkBookSourceConfig.timeout"
            :min="1000"
            :max="15000"
            :step="500"
            size="small"
          >
          </el-input-number>
          <span class="check-form-label">并发数：</span>
          <el-input-number
            v-model="checkBookSourceConfig.concurrent"
            :min="3"
            :max="15"
            :step="1"
            size="small"
          >
          </el-input-number>
        </div>
        <div class="source-group-wrapper">
          <el-tag
            type="info"
            :effect="$store.getters.isNight ? 'dark' : 'light'"
            class="source-group-btn"
            :class="showSourceGroup === name ? 'selected' : ''"
            v-for="name in bookSourceShowGroup"
            :key="'sourceGroup-' + name"
            @click="setShowSourceGroup(name)"
          >
            {{ name }}
          </el-tag>
        </div>
        <el-table
          :data="bookSourceShowResultPageList"
          :height="
            dialogContentHeight - 42 - 42 - (isShowFailureBookSource ? 32 : 0)
          "
          @selection-change="manageSourceSelection = $event"
          :key="isShowFailureBookSource"
        >
          <el-table-column
            type="selection"
            width="25"
            fixed
            :selectable="isBookSourceSelectable"
          >
          </el-table-column>
          <el-table-column
            property="bookSourceName"
            label="书源名称"
            min-width="120"
            fixed
          ></el-table-column>
          <el-table-column
            property="bookSourceUrl"
            label="书源链接"
            min-width="120"
          >
            <template slot-scope="scope">
              <el-link
                type="primary"
                :href="scope.row.bookSourceUrl"
                target="_blank"
                >{{ scope.row.bookSourceUrl }}</el-link
              >
            </template>
          </el-table-column>
          <el-table-column
            property="errorMsg"
            label="错误信息"
            min-width="120"
            v-if="isShowFailureBookSource"
          ></el-table-column>
          <el-table-column label="书架书籍" min-width="120">
            <template slot-scope="scope">
              <pre>{{ showSourceBook(scope.row) }}</pre>
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            width="100px"
            v-if="!isShowFailureBookSource"
          >
            <template slot-scope="scope">
              <el-button type="text" @click="editBookSource(scope.row)"
                >编辑</el-button
              >
            </template>
          </el-table-column>
        </el-table>
        <div class="source-pagination">
          <el-pagination
            :current-page.sync="bookSourcePagination.page"
            :page-sizes="[25, 50, 100, 200, 300, 400]"
            :page-size.sync="bookSourcePagination.size"
            layout="total, sizes, prev, pager, next"
            :total="bookSourceShowLength"
            :pager-count="collapseMenu ? 5 : 7"
          >
          </el-pagination>
        </div>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-button
          type="primary"
          class="float-left"
          size="medium"
          @click="deleteBookSourceList"
          >批量删除</el-button
        >
        <span class="check-tip"
          >已选择 {{ manageSourceSelection.length }} 个</span
        >
        <el-button
          @click="checkBookSource"
          v-if="isShowFailureBookSource"
          size="medium"
          style="margin-bottom: 5px;"
          :disabled="isCheckingBookSource"
          >{{ isCheckingBookSource ? "正在" : "" }}检测书源
          {{ checkBookSourceTip }}</el-button
        >
        <el-button @click="showBookSourceManageDialog = false" size="medium"
          >取消</el-button
        >
      </div>
    </el-dialog>

    <el-dialog
      title="WebDAV文件管理"
      :visible.sync="showWebdavManageDialog"
      :width="dialogWidth"
      :top="dialogTop"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      v-if="$store.getters.isNormalPage"
    >
      <div class="source-container table-container">
        <el-table
          :data="webdavFileList"
          :height="dialogContentHeight"
          @selection-change="webdavFileSelection = $event"
        >
          <el-table-column
            type="selection"
            width="25"
            fixed
            :selectable="row => !row.toParent"
          >
          </el-table-column>
          <el-table-column
            property="name"
            min-width="150px"
            label="文件名"
            fixed
          >
            <template slot-scope="scope">
              <span v-if="!scope.row.isDirectory">{{ scope.row.name }}</span>
              <el-link
                type="primary"
                v-if="scope.row.isDirectory"
                @click="showWebdavFile(scope.row.path)"
                >{{ scope.row.name }}</el-link
              >
            </template>
          </el-table-column>
          <el-table-column
            property="size"
            label="大小"
            :formatter="formatTableField"
            min-width="100px"
          ></el-table-column>
          <el-table-column
            property="lastModified"
            label="修改时间"
            :formatter="formatTableField"
            width="120px"
          ></el-table-column>
          <el-table-column label="操作" width="100px">
            <template slot-scope="scope">
              <el-button
                type="text"
                @click="deleteWebdavFile(scope.row)"
                style="color: #f56c6c"
                v-if="!scope.row.toParent"
                >删除</el-button
              >
              <el-button
                type="text"
                @click="restoreFromWebdav(scope.row)"
                v-if="!scope.row.isDirectory && scope.row.name.endsWith('.zip')"
                >还原</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-button
          type="primary"
          size="medium"
          class="float-left"
          @click="deleteWebdavFileList"
          >批量删除</el-button
        >
        <span class="check-tip"
          >已选择 {{ webdavFileSelection.length }} 个</span
        >
        <el-button size="medium" @click="showWebdavManageDialog = false"
          >取消</el-button
        >
      </div>
    </el-dialog>

    <el-dialog
      :title="'导入本地书籍' + importMultiBookTip"
      :visible.sync="showImportBookDialog"
      :width="dialogSmallWidth"
      :top="dialogTop"
      @closed="importBookDialogClosed"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      v-if="$store.getters.isNormalPage"
    >
      <div class="source-container table-container">
        <div class="check-form">
          <div class="book-cover">
            <el-image
              class="cover"
              :src="getCover(getBookCoverUrl(importBookInfo), true)"
              :key="getBookCoverUrl(importBookInfo)"
              fit="cover"
              lazy
            >
            </el-image>
          </div>
          <div class="book-info">
            <div>
              <span>书名：</span>
              <el-input v-model="importBookInfo.name" size="small"> </el-input>
            </div>
            <div>
              <span>作者：</span>
              <el-input v-model="importBookInfo.author" size="small">
              </el-input>
            </div>
            <div v-if="isShowTocRule">
              <span>规则：</span>
              <el-select
                size="mini"
                v-model="importUsedTxtRule"
                filterable
                placeholder="内置规则"
              >
                <el-option
                  v-for="(rule, index) in $store.state.txtTocRules"
                  :key="'txtTocRule-' + index"
                  :label="rule.name"
                  :value="rule.rule"
                >
                </el-option>
              </el-select>
              <el-button
                class="toc-refresh-btn"
                type="text"
                @click="getChapterListByRule()"
                >刷新目录</el-button
              >
            </div>
            <div v-if="isShowTocRule">
              <el-input
                type="textarea"
                :rows="2"
                v-model="importBookInfo.tocUrl"
                size="small"
              >
              </el-input>
            </div>
          </div>
        </div>
        <div class="chapter-title">
          章节列表({{ importBookChapters.length }})
        </div>
        <div
          class="chapter-list"
          :style="{ maxHeight: dialogContentHeight - 40 - 35 + 'px' }"
        >
          <p v-for="(chapter, index) in importBookChapters" :key="index">
            {{ index + 1 }}. {{ chapter.title }}
          </p>
        </div>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-button
          type="primary"
          size="medium"
          @click="saveBook(importBookInfo, true)"
          >确定导入</el-button
        >
        <el-button size="medium" @click="showImportBookDialog = false"
          >取消</el-button
        >
      </div>
    </el-dialog>

    <el-dialog
      :visible.sync="showRssSourcesDialog"
      :width="dialogWidth"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      @closed="showRssSourceEditButton = false"
      v-if="$store.getters.isNormalPage"
    >
      <div class="custom-dialog-title" slot="title">
        <span class="el-dialog__title"
          >RSS订阅({{ rssSourceList.length }})
          <span
            class="float-right span-btn"
            @click="showRssSourceEditButton = !showRssSourceEditButton"
            >{{ showRssSourceEditButton ? "取消" : "编辑" }}</span
          >
          <span class="float-right span-btn" @click="uploadRssSource"
            >导入</span
          >
          <span class="float-right span-btn" @click="editRssSource(false)"
            >新增</span
          >
        </span>
        <input
          ref="rssInputRef"
          type="file"
          @change="onSourceFileChange($event, true)"
          style="display:none"
        />
      </div>
      <div class="rss-source-list-container">
        <div
          class="rss-source"
          v-for="(source, index) in rssSourceList"
          :key="'rss-' + index"
          @click="getRssArticles(source)"
        >
          <i
            class="el-icon-close"
            v-if="showRssSourceEditButton"
            @click.stop="deleteRssSource(source)"
          ></i>
          <i
            class="el-icon-edit"
            v-if="showRssSourceEditButton"
            @click.stop="editRssSource(source)"
          ></i>
          <el-image
            :src="getImage(source.sourceIcon, true)"
            class="rss-icon"
            fit="cover"
            lazy
          />
          <div class="rss-title">{{ source.sourceName }}</div>
        </div>
      </div>
    </el-dialog>

    <el-dialog
      :title="rssSource.sourceName"
      :visible.sync="showRssArticlesDialog"
      :width="dialogWidth"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      @closed="rssArticleList = []"
      v-if="$store.getters.isNormalPage"
    >
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
          @click="hasMoreRssArticles && getRssArticles(rssSource, rssPage + 1)"
        >
          {{ hasMoreRssArticles ? "加载更多" : "没有更多啦" }}
        </div>
      </div>
    </el-dialog>

    <el-dialog
      :title="rssArticleInfo.title"
      :visible.sync="showRssArticleContentDialog"
      :width="dialogWidth"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      @closed="rssArticleInfo = {}"
      v-if="$store.getters.isNormalPage"
    >
      <div class="rss-article-info-container">
        <div
          class="rss-article-content"
          ref="rssArticleContentRef"
          v-html="rssArticleInfo.content || rssArticleInfo.description"
          @click="rssArticleClickHandler"
        ></div>
      </div>
    </el-dialog>

    <LocalStore
      v-model="showLocalStoreManageDialog"
      :dialogWidth="dialogWidth"
      :dialogTop="dialogTop"
      :dialogContentHeight="dialogContentHeight"
      @importFromLocalStorePreview="importMultiBooks"
    ></LocalStore>
  </div>
</template>

<script>
import { mapGetters } from "vuex";
import Explore from "../components/Explore.vue";
import LocalStore from "../components/LocalStore.vue";
import Axios from "../plugins/axios";
import { errorTypeList } from "../plugins/config";
import { setCache, getCache } from "../plugins/cache";
import eventBus from "../plugins/eventBus";
import { formatSize, LimitResquest } from "../plugins/helper";
const buildURL = require("axios/lib/helpers/buildURL");
import { isInContainer } from "element-ui/src/utils/dom";

export default {
  components: {
    Explore,
    LocalStore
  },
  data() {
    return {
      search: "",
      searchTypeList: [
        { name: "单源搜索", value: "single" },
        { name: "多源搜索(过滤书名/作者名)", value: "multi" }
      ],
      isSearchResult: false,
      isExploreResult: false,
      searchResult: [],
      searchPage: 1,
      refreshLoading: false,
      searchLastIndex: -1,

      showBookEditButton: false,

      popExploreVisible: false,
      loadingMore: false,

      importSourceList: [],
      showImportSourceDialog: false,
      isImportRssSource: false,
      checkAll: false,
      isIndeterminate: false,
      checkedSourceIndex: [],

      showBookSourceManageDialog: false,
      manageSourceSelection: [],
      isShowFailureBookSource: false,
      checkBookSourceTip: "",
      isCheckingBookSource: false,

      showNavigation: false,

      navigationClass: "",
      navigationStyle: {},

      popIntroVisible: {},

      connecting: false,

      lastScrollTop: 0,

      webdavCurrentPath: "/",
      webdavFileList: [],

      showWebdavManageDialog: false,
      webdavFileSelection: [],

      localStorageAvaliable:
        window.localStorage &&
        window.localStorage.getItem &&
        window.localStorage.setItem,

      showSourceGroup: "",
      bookSourcePagination: {
        page: 1,
        size: 25
      },
      checkBookSourceConfig: {
        keyword: "斗罗大陆",
        timeout: 5000,
        concurrent: 5
      },
      importBookInfo: {},
      importBookChapters: [],
      showImportBookDialog: false,

      importMultiBookTip: "",

      showRssSourcesDialog: false,

      showRssSourceEditButton: false,

      showRssArticlesDialog: false,
      hasMoreRssArticles: true,
      rssArticleList: [],
      rssPage: 1,
      rssSource: {},

      showRssArticleContentDialog: false,
      rssArticleInfo: {},
      concurrentList: [12, 18, 24, 30, 36, 42, 48, 54, 60],

      localCacheStats: {
        total: "0 Bytes",
        bookSourceList: "0 Bytes",
        rssSources: "0 Bytes",
        chapterList: "0 Bytes",
        chapterContent: "0 Bytes"
      },

      showLocalStoreManageDialog: false,
      importUsedTxtRule: "",

      showAddUser: false,
      addUserForm: {
        username: "",
        password: ""
      }
    };
  },
  watch: {
    searchConfig: {
      handler(val) {
        this.$store.commit("setSearchConfig", val);
        if (this.isSearchResult) {
          this.searchBook(1);
        }
      },
      deep: true
    },
    searchResult(val) {
      if (this.isSearchResult && val.length) {
        this.$nextTick(() => {
          this.$refs.bookList.scrollTop = this.lastScrollTop;
        });
      }
    },
    collapseMenu(val) {
      if (!val) {
        this.navigationClass = "";
      } else if (!this.showNavigation) {
        this.navigationClass = "navigation-hidden";
      }
    },
    showNavigation(val) {
      if (!val) {
        this.navigationClass = "navigation-out";
        setTimeout(() => {
          this.navigationClass = "navigation-hidden";
        }, 300);
      } else {
        this.navigationClass = "navigation-in";
      }
    },
    loginAuth() {
      this.init(true);
    },
    userNS() {
      this.init(true);
    },
    showRssArticlesDialog(val) {
      if (val) {
        this.$nextTick(() => {
          this.$refs.rssArticleListRef &&
            (this.$refs.rssArticleListRef.scrollTop = 0);
        });
      }
    },
    importUsedTxtRule(val) {
      if (val) {
        this.importBookInfo.tocUrl = val;
      }
    },
    showBookGroup() {
      this.$nextTick(() => {
        // 手动处理 el-image 图片加载
        setTimeout(this.ensureLoadBookCover);
      });
    }
  },
  mounted() {
    document.title = "阅读";
    this.navigationClass =
      this.collapseMenu && !this.showNavigation ? "navigation-hidden" : "";
    window.shelfPage = this;
    this.init();
  },
  activated() {
    document.title = "阅读";
    this.scanCacheStorage();
  },
  methods: {
    init(refresh) {
      this.$root.$children[0].init(refresh);
    },
    setIP() {
      this.$prompt("请输入接口地址 ( 如：localhost:8080/reader3 )", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValue: this.api,
        // inputPattern: /^((2[0-4]\d|25[0-5]|[1]?\d\d?)\.){3}(2[0-4]\d|25[0-5]|[1]?\d\d?):([1-9]|[1-9][0-9]|[1-9][0-9][0-9]|[1-9][0-9][0-9][0-9]|[1-6][0-5][0-5][0-3][0-5])$/,
        // inputErrorMessage: "url 形式不正确",
        beforeClose: (action, instance, done) => {
          if (action === "confirm") {
            this.connecting = true;
            instance.confirmButtonLoading = true;
            instance.confirmButtonText = "校验中……";
            var inputUrl = instance.inputValue.replace(/\/*$/g, "");
            this.loadBookshelf(inputUrl)
              .then(() => {
                this.connecting = false;
                instance.confirmButtonLoading = false;
                done();
                setCache("api_prefix", inputUrl);
                this.$store.commit("setApi", inputUrl);
                // 初始化
                this.init();
              })
              .catch(() => {
                instance.confirmButtonLoading = false;
                instance.confirmButtonText = "确定";
              });
          } else {
            done();
          }
        }
      })
        .then(({ value }) => {
          this.$message({
            type: "success",
            message: "与" + value + "连接成功"
          });
        })
        .catch(() => {});
    },
    loadBookshelf(api, refresh) {
      api = api || this.api;
      if (!api) {
        this.$message.error("请先设置后端接口地址");
        this.$store.commit("setConnected", false);
        return Promise.reject(false);
      }

      if (!this.loading || !this.loading.visible) {
        this.loading = this.$loading({
          target: this.$refs.bookList,
          lock: true,
          text: refresh ? "正在刷新书籍信息" : "正在获取书籍信息",
          spinner: "el-icon-loading",
          background: this.isNight ? "#222" : "#fff"
        });
      }

      if (
        !api.startsWith("http://") &&
        !api.startsWith("https://") &&
        !api.startsWith("//")
      ) {
        api = "//" + api;
      }

      return this.$root.$children[0].loadBookShelf(refresh, api).then(() => {
        this.loading.close();
      });
    },
    refreshShelf() {
      return this.loadBookshelf(null, true);
    },
    loadBookGroup(refresh) {
      return this.$root.$children[0].loadBookGroup(refresh);
    },
    loadBookSource(refresh) {
      return this.$root.$children[0].loadBookSource(refresh);
    },
    searchBook(page) {
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      if (!this.search) {
        this.$message.error("请输入关键词进行搜索");
        return;
      }
      if (
        this.searchConfig.searchType === "single" &&
        !this.searchConfig.bookSourceUrl
      ) {
        this.$message.error("请选择书源进行搜索");
        return;
      }
      if (page) {
        this.searchPage = page;
      }
      page = this.searchPage;
      if (page === 1) {
        // 重新搜索
        this.searchLastIndex = -1;
      }
      if (this.searchConfig.searchType === "multi" && window.EventSource) {
        this.searchBookByEventStream(page);
        return;
      }
      if (this.loadingMore) {
        return;
      }
      this.isSearchResult = true;
      this.isExploreResult = false;
      this.loadingMore = true;
      if (page === 1) {
        this.searchResult = [];
      }
      Axios.get(
        this.api +
          (this.searchConfig.searchType === "single"
            ? "/searchBook"
            : "/searchBookMulti"),
        {
          timeout: this.searchConfig.searchType === "single" ? 30000 : 180000,
          params: {
            key: this.search,
            bookSourceUrl: this.searchConfig.bookSourceUrl,
            bookSourceGroup: this.searchConfig.bookSourceGroup,
            concurrentCount: this.searchConfig.concurrentCount,
            lastIndex: this.searchLastIndex, // 多源搜索时的索引
            page: page // 单源搜索时的page
          }
        }
      ).then(
        res => {
          this.loadingMore = false;
          if (res.data.isSuccess) {
            //
            let resultList = [];
            if (this.searchConfig.searchType === "single") {
              resultList = res.data.data;
            } else {
              this.searchLastIndex = res.data.data.lastIndex;
              resultList = res.data.data.list;
            }
            var data = [].concat(this.searchResult);
            var length = data.length;
            resultList.forEach(v => {
              if (!this.searchResultMap[v.bookUrl]) {
                data.push(v);
              }
            });
            this.searchResult = data;
            if (data.length === length) {
              this.$message.error("没有更多啦");
            }
          }
        },
        error => {
          this.$message.error("搜索书籍失败 " + (error && error.toString()));
        }
      );
    },
    searchBookByEventStream(page) {
      const tryClose = () => {
        try {
          if (
            this.searchEventSource &&
            this.searchEventSource.readyState != this.searchEventSource.CLOSED
          ) {
            this.searchEventSource.close();
          }
          this.searchEventSource = null;
        } catch (error) {
          //
        }
      };
      if (this.loadingMore) {
        tryClose();
        this.loadingMore = false;
        // page === 1 是重新搜索
        if (page !== 1) {
          // 停止搜索
          return;
        }
      }
      const params = {
        accessToken: this.$store.state.token,
        key: this.search,
        bookSourceUrl: this.searchConfig.bookSourceUrl,
        bookSourceGroup: this.searchConfig.bookSourceGroup,
        concurrentCount: this.searchConfig.concurrentCount,
        lastIndex: this.searchLastIndex, // 多源搜索时的索引
        page: page // 单源搜索时的page
      };

      this.isSearchResult = true;
      this.isExploreResult = false;
      this.loadingMore = true;
      if (page === 1) {
        this.searchResult = [];
      }
      const url = buildURL(this.api + "/searchBookMultiSSE", params);

      tryClose();

      this.searchEventSource = new EventSource(url, {
        withCredentials: true
      });
      this.searchEventSource.addEventListener("error", e => {
        this.loadingMore = false;
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
      let oldSearchResultLength = this.searchResult.length;
      this.searchEventSource.addEventListener("end", e => {
        this.loadingMore = false;
        tryClose();
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.lastIndex) {
              this.searchLastIndex = result.lastIndex;
            }
          }
          if (this.searchResult.length === oldSearchResultLength) {
            this.$message.error("没有更多啦");
          }
        } catch (error) {
          //
        }
      });
      this.searchEventSource.addEventListener("message", e => {
        try {
          if (e.data) {
            const result = JSON.parse(e.data);
            if (result && result.lastIndex) {
              this.searchLastIndex = result.lastIndex;
            }
            if (result.data) {
              var data = [].concat(this.searchResult);
              result.data.forEach(v => {
                if (!this.searchResultMap[v.bookUrl]) {
                  data.push(v);
                }
              });
              this.searchResult = data;
            }
          }
        } catch (error) {
          //
        }
      });
    },
    toDetail(book) {
      if (!book.bookUrl) {
        return;
      }
      if (this.isSearchResult) {
        // this.$message.error("请先加入书架");
        // return;
      }
      this.$store.commit("setReadingBook", {
        bookName: book.bookName || book.name,
        bookUrl: book.bookUrl,
        index: book.index ?? book.durChapterIndex ?? 0,
        type: book.type,
        coverUrl: this.getBookCoverUrl(book),
        author: book.author,
        origin: book.origin,
        latestChapterTitle: book.latestChapterTitle,
        intro: book.intro
      });
      this.$router.push({
        path: "/reader" + (this.isSearchResult ? "?search=1" : "")
      });
    },
    saveBook(book, isImport, isEdit) {
      if (!book || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return Promise.reject(false);
      }
      return Axios.post(this.api + "/saveBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            if (isImport) {
              this.showImportBookDialog = false;
            }
            this.$message.success(
              isImport
                ? "导入书籍成功"
                : isEdit
                ? "修改书籍成功"
                : "加入书架成功"
            );
            if (!isEdit) {
              this.loadBookshelf();
            } else {
              this.$store.commit("updateShelfBook", res.data.data);
            }
            return res.data.data;
          }
        },
        error => {
          this.$message.error(
            (isImport
              ? "导入书籍失败"
              : isEdit
              ? "修改书籍失败"
              : "加入书架失败 ") + (error && error.toString())
          );
        }
      );
    },
    async deleteBook(book) {
      if (!book || !book.name || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      const res = await this.$confirm(
        "此操作将删除书籍信息以及阅读进度, 是否继续?",
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
      Axios.post(this.api + "/deleteBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("删除成功");
            this.loadBookshelf();
          }
        },
        error => {
          this.$message.error("删除失败 " + (error && error.toString()));
        }
      );
    },
    editBook(book, isAdd) {
      if (!book || !book.name || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      const bookInfo = { ...book };
      delete bookInfo["variableMap$delegate"];
      eventBus.$emit(
        "showEditor",
        isAdd ? "保存书籍" : "编辑书籍",
        JSON.stringify(bookInfo, null, 4),
        async (content, close) => {
          try {
            const newBook = JSON.parse(content);
            if (!newBook.name) {
              this.$message.error("书籍名称不能为空");
              return;
            }
            if (!newBook.bookUrl) {
              this.$message.error("书籍链接不能为空");
              return;
            }
            if (!newBook.origin) {
              this.$message.error("书籍来源不能为空");
              return;
            }
            if (isAdd) {
              const res = await this.$confirm(
                "加入书架之后才能编辑书籍信息, 是否加入书架?",
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
            }
            this.saveBook(newBook, false, true).then(() => {
              close();
            });
          } catch (e) {
            this.$message.error("书籍信息必须是JSON格式");
          }
        }
      );
    },
    currentDateTime() {
      const now = new Date();
      const pad = a => (a < 10 ? "0" + a : a);
      return (
        now.getFullYear() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        "_" +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds())
      );
    },
    dateFormat(t) {
      let time = new Date().getTime();
      let int = parseInt((time - t) / 1000);
      let str = "";

      if (int <= 30) {
        str = "刚刚";
      } else if (int < 60) {
        str = int + "秒前";
      } else if (int < 3600) {
        str = parseInt(int / 60) + "分钟前";
      } else if (int < 86400) {
        str = parseInt(int / 3600) + "小时前";
      } else if (int < 2592000) {
        str = parseInt(int / 86400) + "天前";
      } else if (int < 31536000) {
        str = parseInt(int / 2592000) + "月前";
      } else {
        str = parseInt(int / 31536000) + "年前";
      }
      return str;
    },
    backToShelf() {
      this.isSearchResult = false;
      this.isExploreResult = false;
      this.searchResult = [];
      this.loadingMore = false;
    },
    toogleNight() {
      if (this.isNight) {
        this.$store.commit("setNightTheme", false);
      } else {
        this.$store.commit("setNightTheme", true);
      }
    },
    showSearchList(data) {
      this.isSearchResult = true;
      this.isExploreResult = true;
      this.loadingMore = false;
      this.searchResult = data;
    },
    loadMore() {
      this.lastScrollTop = this.$refs.bookList.scrollTop;
      if (this.isExploreResult) {
        this.loadingMore = true;
        this.$refs.popExplore.loadMore();
      } else {
        this.searchBook(this.searchPage + 1);
      }
    },
    uploadBookSource() {
      this.$refs.fileRef.dispatchEvent(new MouseEvent("click"));
    },
    onSourceFileChange(event, isRssSource) {
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      const reader = new FileReader();
      const sourceTypeName = isRssSource ? "RSS源" : "书源";
      reader.onload = e => {
        const data = e.target.result;
        try {
          this.importSourceList = JSON.parse(data);
          this.showImportSourceDialog = true;
          this.isImportRssSource = !!isRssSource;
        } catch (error) {
          this.$message.error(sourceTypeName + "文件错误");
        }
      };
      reader.onerror = () => {
        // console.log("FileReader error", e);
        // FileReader 读取出错，只能上传读取了
        let param = new FormData();
        param.append("file", rawFile);
        Axios.post(this.api + "/readSourceFile", param, {
          headers: { "Content-Type": "multipart/form-data" }
        }).then(
          res => {
            if (res.data.isSuccess) {
              //
              let sourceList = [];
              res.data.data.forEach(v => {
                try {
                  const data = JSON.parse(v);
                  if (Array.isArray(data)) {
                    sourceList = sourceList.concat(data);
                  }
                } catch (error) {
                  //
                }
              });
              if (sourceList.length) {
                this.importSourceList = sourceList.map(v => {
                  if (v.headerMap) {
                    if (!v.header) {
                      v.header =
                        typeof v.headerMap === "string"
                          ? v.headerMap
                          : JSON.stringify(v.headerMap);
                    }
                    delete v.headerMap;
                  }
                  return v;
                });
                this.showImportSourceDialog = true;
                this.isImportRssSource = !!isRssSource;
              } else {
                this.$message.error(sourceTypeName + "文件错误");
              }
            }
          },
          error => {
            this.$message.error(
              "读取" +
                sourceTypeName +
                "文件内容失败 " +
                (error && error.toString())
            );
          }
        );
      };
      reader.readAsText(rawFile);
      if (this.isRssSource) {
        this.$refs.rssInputRef.value = null;
      } else {
        this.$refs.fileRef.value = null;
      }
    },
    async loadRemoteBookSource() {
      const lastRemoteSourceUrl = getCache(
        this.currentUserName + "@lastRemoteSourceUrl",
        ""
      );
      const res = await this.$prompt("请输入远程书源链接", "导入远程书源文件", {
        inputValue: lastRemoteSourceUrl || "",
        confirmButtonText: "确定",
        cancelButtonText: "取消"
      }).catch(() => {
        return false;
      });
      if (!res || !res.value) {
        return;
      }
      Axios.post(this.api + "/readRemoteSourceFile", {
        url: res.value
      }).then(
        res => {
          if (res.data.isSuccess) {
            setCache(this.currentUserName + "@lastRemoteSourceUrl", res.value);
            //
            let sourceList = [];
            res.data.data.forEach(v => {
              try {
                const data = JSON.parse(v);
                if (Array.isArray(data)) {
                  sourceList = sourceList.concat(data);
                }
              } catch (error) {
                //
              }
            });
            if (sourceList.length) {
              this.importSourceList = sourceList;
              this.showImportSourceDialog = true;
              this.isImportRssSource = false;
            } else {
              this.$message.error("远程书源文件错误");
            }
          }
        },
        error => {
          this.$message.error(
            "读取远程书源文件内容失败 " + (error && error.toString())
          );
        }
      );
    },
    handleCheckAllChange(val) {
      let hasFilterd = false;
      this.checkedSourceIndex = val
        ? this.importSourceList
            .map((v, i) => {
              // 不勾选使用了 js，webview的书源
              const source = JSON.stringify(v);
              if (
                source.indexOf("@js:") !== -1 ||
                source.indexOf("webView:") !== -1
              ) {
                hasFilterd = true;
                return false;
              }
              return i;
            })
            .filter(v => v)
        : [];
      if (val && hasFilterd) {
        this.$message.info("部分使用了Javascript和Webview的书源未勾选");
      }
      this.isIndeterminate = false;
    },
    handleCheckedSourcesChange(value) {
      let checkedCount = value.length;
      this.checkAll = checkedCount === this.importSourceList.length;
      this.isIndeterminate =
        checkedCount > 0 && checkedCount < this.importSourceList.length;
    },
    getSourceTag(source) {
      const sourceStr = JSON.stringify(source);
      const tags = [];
      if (sourceStr.indexOf("@js:") !== -1) {
        tags.push("@Javascript");
      }

      if (sourceStr.indexOf("webView:") !== -1) {
        tags.push("@WebView");
      }

      return "   " + tags.join("  ");
    },
    saveSourceList() {
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      if (!this.checkedSourceIndex.length) {
        this.$message.error("请选择需要导入的源");
        return;
      }
      const sourceList = this.checkedSourceIndex.map(
        v => this.importSourceList[v]
      );
      Axios.post(
        this.api +
          (this.isImportRssSource ? "/saveRssSources" : "/saveSources"),
        sourceList
      ).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success(
              this.isImportRssSource ? "导入RSS源成功" : "导入书源成功"
            );
            if (this.isImportRssSource) {
              this.loadRssSources(true);
            } else {
              this.loadBookSource(true);
            }
            this.showImportSourceDialog = false;
            this.isImportRssSource = false;
            this.checkedSourceIndex = [];
          }
        },
        error => {
          this.$message.error(
            (this.isImportRssSource ? "导入RSS源失败 " : "导入书源失败 ") +
              (error && error.toString())
          );
        }
      );
    },
    isBookSourceSelectable(bookSource) {
      const res = [];
      (this.$store.state.shelfBooks || []).forEach(v => {
        if (v.origin === bookSource.bookSourceUrl) {
          res.push(v.name);
        }
      });
      return !res.length;
    },
    showSourceBook(bookSource) {
      const res = [];
      (this.$store.state.shelfBooks || []).forEach(v => {
        if (v.origin === bookSource.bookSourceUrl) {
          res.push(v.name);
        }
      });
      return res.join("\n");
    },
    getInvalidBookSources() {
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      Axios.post(this.api + "/getInvalidBookSources").then(
        res => {
          if (res.data.isSuccess) {
            //
            res.data.data.forEach(v => {
              this.$store.commit("addFailureBookSource", {
                bookSourceUrl: v.sourceUrl,
                errorMsg: v.error
              });
            });
          }
        },
        () => {
          //
        }
      );
    },
    async checkBookSource() {
      if (!this.checkBookSourceConfig.keyword) {
        this.$message.error("请输入搜索关键词");
        return;
      }
      this.isCheckingBookSource = true;
      this.$store.commit("setFailureIncludeTimeout", true);
      const limitFunc = LimitResquest(
        this.checkBookSourceConfig.concurrent,
        handler => {
          this.checkBookSourceTip =
            handler.requestCount + "/" + this.bookSourceList.length;
          if (handler.isEnd()) {
            this.isCheckingBookSource = false;
            this.$store.commit("setFailureIncludeTimeout", false);
          }
        }
      );
      this.bookSourceList.forEach(v => {
        limitFunc(() => {
          return Axios.get(this.api + "/searchBook", {
            timeout: this.checkBookSourceConfig.timeout,
            params: {
              key: this.checkBookSourceConfig.keyword,
              bookSourceUrl: v.bookSourceUrl
            },
            silent: true
          });
        });
      });
    },
    async deleteBookSourceList() {
      if (!this.manageSourceSelection.length) {
        this.$message.error("请选择需要删除的源");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的书源吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteSources", this.manageSourceSelection).then(
        res => {
          if (res.data.isSuccess) {
            this.$store.commit(
              "removeFailureBookSource",
              this.manageSourceSelection
            );
            this.manageSourceSelection = [];
            this.$message.success("删除书源成功");
            this.loadBookSource(true);
          }
        },
        error => {
          this.$message.error("删除书源失败 " + (error && error.toString()));
        }
      );
    },
    toggleMenu() {
      if (this.collapseMenu) {
        this.showNavigation = !this.showNavigation;
      }
    },
    showExplorePop() {
      setTimeout(() => {
        this.popExploreVisible = true;
      }, 100);
    },
    showBookInfoDialog(book) {
      eventBus.$emit("showBookInfoDialog", book);
    },
    async saveUserConfig() {
      if (!window.localStorage) {
        this.$message.error("当前终端不支持localStorage");
        return;
      }
      const res = await this.$confirm(
        "确认要备份当前终端的阅读配置、书架设置、搜索设置、自定义配置方案吗?",
        "提示"
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      const userConfig = {};
      ["config", "shelfConfig", "searchConfig", "customConfigList"].forEach(
        key => {
          const val = getCache(key);
          if (val) {
            userConfig[key] = val;
          }
        }
      );
      Axios.post(this.api + "/saveUserConfig", userConfig).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("备份成功");
          }
        },
        error => {
          this.$message.error("备份失败 " + (error && error.toString()));
        }
      );
    },
    async restoreUserConfig() {
      if (!window.localStorage) {
        this.$message.error("当前终端不支持localStorage");
        return;
      }
      const res = await this.$confirm(
        "确认要从备份文件中恢复当前终端的阅读配置、书架设置、搜索设置、自定义配置方案吗?",
        "提示"
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      const userConfig = {};
      Axios.get(this.api + "/getUserConfig", userConfig).then(
        res => {
          if (res.data.isSuccess) {
            for (const key in res.data.data) {
              if (Object.hasOwnProperty.call(res.data.data, key)) {
                setCache(key, res.data.data[key]);
              }
            }
            this.$store.dispatch("syncFromLocalStorage");
            this.$message.success("恢复成功");
          }
        },
        error => {
          this.$message.error("恢复失败 " + (error && error.toString()));
        }
      );
    },
    loadUserList() {
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      Axios.get(this.api + "/getUserList").then(
        res => {
          if (res.data.isSuccess) {
            this.userNS = this.$store.state.userInfo.username;
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
            this.$store.commit("setIsManagerMode", true);
          }
        },
        error => {
          this.$message.error(
            "加载用户空间失败 " + (error && error.toString())
          );
        }
      );
    },
    formatTableField(row, column, cellValue) {
      switch (column.property) {
        case "createdAt":
        case "lastLoginAt":
        case "lastModified":
          return cellValue ? new Date(cellValue).format("yy-MM-dd hh:mm") : "";
        case "size":
          return row.isDirectory ? "" : formatSize(cellValue);
        default:
          return cellValue;
      }
    },
    exitSecureMode() {
      this.userNS = "default";
      this.userList = [];
      this.$store.commit("setIsManagerMode", false);
      this.init(true);
    },
    showWebdavFile(path) {
      this.webdavCurrentPath = path || "/";
      Axios.get(this.api + "/getWebdavFileList", {
        params: {
          path: this.webdavCurrentPath
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            res.data.data = res.data.data || [];
            if (this.webdavCurrentPath !== "/") {
              const paths = this.webdavCurrentPath.split("/").filter(v => v);
              paths.pop();
              res.data.data.unshift({
                name: "..",
                isDirectory: true,
                toParent: true,
                path: "/" + paths.join("/")
              });
            }
            this.webdavFileList = res.data.data;
            this.showWebdavManageDialog = true;
          }
        },
        error => {
          this.$message.error(
            "加载WebDAV文件列表失败 " + (error && error.toString())
          );
        }
      );
    },
    async deleteWebdavFileList() {
      if (!this.webdavFileSelection.length) {
        this.$message.error("请选择需要删除的文件");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的文件吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteWebdavFileList", {
        path: this.webdavFileSelection.map(v => v.path)
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.webdavFileSelection = [];
            this.$message.success("删除文件成功");
            this.showWebdavFile(this.webdavCurrentPath);
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    async deleteWebdavFile(row) {
      const res = await this.$confirm(
        `确认要删除该${row.isDirectory ? "文件夹" : "文件"}吗?`,
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
      Axios.post(this.api + "/deleteWebdavFile", {
        path: row.path
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除文件成功");
            this.showWebdavFile(this.webdavCurrentPath);
          }
        },
        error => {
          this.$message.error("删除文件失败 " + (error && error.toString()));
        }
      );
    },
    async restoreFromWebdav(row) {
      const res = await this.$confirm(
        `确认要从该压缩文件恢复书源、书架、分组和RSS订阅数据吗?`,
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
      Axios.post(this.api + "/restoreFromWebdav", {
        path: row.path
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("恢复成功");
            this.init(true);
          }
        },
        error => {
          this.$message.error("恢复失败 " + (error && error.toString()));
        }
      );
    },
    async backupToWebdav() {
      const res = await this.$confirm(
        `确认要用当前书源和书架信息覆盖备份文件中的书源、书架、分组和RSS订阅数据吗?`,
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
      Axios.post(this.api + "/backupToWebdav").then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("备份成功");
          }
        },
        error => {
          this.$message.error("备份失败 " + (error && error.toString()));
        }
      );
    },
    handleTouchStart(e) {
      this.lastTouch = false;
      this.lastMoveX = false;
      this.touchMoveTimes = 0;
      // 边缘 20px 以内禁止触摸
      if (
        e.touches &&
        e.touches[0] &&
        e.touches[0].clientX > 20 &&
        e.touches[0].clientX < window.innerWidth - 20 &&
        e.touches[0].clientY > 20 &&
        e.touches[0].clientY < window.innerHeight - 20
      ) {
        this.lastTouch = e.touches[0];
      }
    },
    handleTouchMove(e) {
      if (e.touches && e.touches[0] && this.lastTouch) {
        if (this.collapseMenu) {
          const moveX = e.touches[0].clientX - this.lastTouch.clientX;
          const moveY = e.touches[0].clientY - this.lastTouch.clientY;
          if (Math.abs(moveY) > Math.abs(moveX)) {
            this.navigationStyle = {};
            this.lastMoveX = 0;
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          if (!this.showNavigation && moveX > 0 && moveX <= 270) {
            // 往右拉，打开目录
            if (this.touchMoveTimes % 3 === 0) {
              this.navigationStyle = {
                marginLeft: moveX - 270 + "px"
              };
            }
            this.lastMoveX = moveX;
          } else if (this.showNavigation && moveX < 0 && moveX >= -270) {
            // 往左拉，关闭目录
            if (this.touchMoveTimes % 3 === 0) {
              this.navigationStyle = {
                marginLeft: moveX + "px"
              };
            }
            this.lastMoveX = moveX;
          }
          this.touchMoveTimes++;
        }
      }
    },
    handleTouchEnd() {
      if (this.collapseMenu) {
        if (this.lastMoveX > 0) {
          this.showNavigation = true;
          this.navigationStyle = {};
        } else if (this.lastMoveX < 0) {
          this.showNavigation = false;
          this.navigationStyle = {};
        }
      }
    },
    showFailureBookSource() {
      this.getInvalidBookSources();
      this.isShowFailureBookSource = true;
      this.showBookSourceManageDialog = true;
    },
    setShowSourceGroup(group) {
      if (this.showSourceGroup === group) {
        this.showSourceGroup = "";
      } else {
        this.showSourceGroup = group;
      }
    },
    importLocalBook() {
      this.$refs.bookRef.dispatchEvent(new MouseEvent("click"));
    },
    onBookFileChange(event) {
      if (!event.target || !event.target.files || !event.target.files.length) {
        return;
      }
      let param = new FormData();
      for (let i = 0; i < event.target.files.length; i++) {
        const file = event.target.files[i];
        param.append("file" + i, file);
      }
      Axios.post(this.api + "/importBookPreview", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess && res.data.data.length) {
            if (res.data.data.length > 1) {
              // 批量导入
              this.importMultiBooks(res.data.data);
            } else {
              //
              this.importBookInfo = res.data.data[0].book;
              this.importBookChapters = res.data.data[0].chapters;
              this.showImportBookDialog = true;
            }
          }
        },
        error => {
          this.$message.error("上传书籍 " + (error && error.toString()));
        }
      );
      this.$refs.bookRef.value = null;
    },
    async importMultiBooks(books) {
      if (!books || !books.length) {
        return;
      }
      if (books.length == 1) {
        this.importBookInfo = books[0].book;
        this.importBookChapters = books[0].chapters;
        this.showImportBookDialog = true;
        return;
      }
      const res = await this.$confirm(
        `你选择导入多本书籍，请选择导入方式?`,
        "提示",
        {
          confirmButtonText: "批量导入",
          cancelButtonText: "逐一确认导入",
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
      if (res) {
        for (let i = 0; i < books.length; i++) {
          const book = books[i];
          await this.saveBook(book.book, true).catch(() => {});
        }
      } else {
        for (let i = 0; i < books.length; i++) {
          const book = books[i];
          this.importMultiBookTip = `（${i + 1}/${books.length}）`;
          await this.waitForImportBook(book);
        }
        this.importMultiBookTip = "";
      }
    },
    waitForImportBook(bookInfo) {
      return new Promise(resolve => {
        this.importBookInfo = bookInfo.book;
        this.importBookChapters = bookInfo.chapters;
        this.showImportBookDialog = true;
        this.$once("importEnd", resolve);
      });
    },
    importBookDialogClosed() {
      const url = this.importBookInfo.bookUrl;
      this.importBookInfo = {};
      this.importBookChapters = [];
      this.importUsedTxtRule = "";
      this.$nextTick(() => {
        this.$emit("importEnd");
      });

      Axios.post(
        this.api + "/deleteFile",
        {
          url
        },
        {
          silent: true
        }
      ).then(
        () => {
          //
        },
        () => {
          //
        }
      );
    },
    showManageBookGroup() {
      this.loadBookGroup(true);
      eventBus.$emit("showBookGroupDialog", false);
    },
    getShowShelfBooks(bookGroup) {
      // 处理特殊分组
      if (bookGroup === -1) {
        // 全部
        return this.shelfBooks;
      } else if (bookGroup === -2) {
        // 本地
        return this.shelfBooks.filter(v => v.origin === "loc_book");
      } else if (bookGroup === -3) {
        // 音频
        return this.shelfBooks.filter(v => v.type === 1);
      } else if (bookGroup === -4) {
        // 未分组
        return this.shelfBooks.filter(v => v.group === 0);
      }

      return this.shelfBooks.filter(v =>
        bookGroup === 0 ? true : v.group & bookGroup
      );
    },
    loadRssSources(refresh) {
      return this.$root.$children[0].loadRssSources(refresh);
    },
    showRssDialog() {
      //
      this.showRssSourcesDialog = true;
    },
    async deleteRssSource(source) {
      const res = await this.$confirm(`确认要删除该RSS订阅源吗?`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteRssSource", source).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除成功");
            this.loadRssSources(true);
          }
        },
        error => {
          this.$message.error("删除失败 " + (error && error.toString()));
        }
      );
    },
    uploadRssSource() {
      this.$refs.rssInputRef.dispatchEvent(new MouseEvent("click"));
    },
    getRssArticles(source, page) {
      //
      this.rssSource = source;
      this.rssPage = page || 1;
      if (this.rssPage === 1) {
        this.hasMoreRssArticles = true;
      }
      Axios.post(this.api + "/getRssArticles", {
        sourceUrl: source.sourceUrl,
        page: this.rssPage
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            if (!res.data.data.length) {
              this.$message.error("没有数据");
              this.hasMoreRssArticles = false;
              return;
            }
            if (this.rssPage > 1) {
              this.rssArticleList = []
                .concat(this.rssArticleList)
                .concat(res.data.data);
            } else {
              this.showRssArticlesDialog = true;
              this.rssArticleList = res.data.data;
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
    getRssArticleContent(article) {
      Axios.post(this.api + "/getRssContent", {
        sourceUrl: this.rssSource.sourceUrl,
        link: article.link,
        origin: article.origin
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.showRssArticleContentDialog = true;
            this.rssArticleInfo = {
              ...article,
              content: res.data.data
            };
          }
        },
        error => {
          this.$message.error(
            "加载RSS文章内容失败 " + (error && error.toString())
          );
        }
      );
    },
    noop() {},
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
    },
    exportBookSource() {
      Axios.get(this.api + "/getSources").then(
        res => {
          if (res.data.isSuccess) {
            const aEle = document.createElement("a");
            const blob = new Blob([
              JSON.stringify(res.data.data || [], null, 4)
            ]);

            aEle.download = "reader书源-" + this.currentDateTime() + ".json";
            aEle.href = URL.createObjectURL(blob);
            aEle.click();
          }
        },
        error => {
          this.$message.error("导出书源失败 " + (error && error.toString()));
        }
      );
    },
    async deleteAllBookSource() {
      const res = await this.$confirm(`确认要清空所有书源吗?`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteAllSources").then(
        res => {
          if (res.data.isSuccess) {
            //
            this.loadBookSource(true);
            this.$message.success("清空书源成功");
            this.loadBookSource(true);
          }
        },
        error => {
          this.$message.error("清空书源失败 " + (error && error.toString()));
        }
      );
    },
    editBookSource(bookSource) {
      const editHandler = data => {
        eventBus.$emit(
          "showEditor",
          "编辑书源",
          JSON.stringify(data, null, 4),
          (content, close) => {
            try {
              const source = JSON.parse(content);
              if (!source.bookSourceName) {
                this.$message.error("书源名称不能为空");
                return;
              }
              if (!source.bookSourceUrl) {
                this.$message.error("书源链接不能为空");
                return;
              }
              Axios.post(this.api + "/saveSource", source).then(
                res => {
                  if (res.data.isSuccess) {
                    //
                    close();
                    this.$message.success("保存书源成功");
                    this.loadBookSource(true);
                  }
                },
                error => {
                  this.$message.error(
                    "保存书源失败 " + (error && error.toString())
                  );
                }
              );
            } catch (e) {
              this.$message.error("书源必须是JSON格式");
            }
          }
        );
      };
      if (!bookSource) {
        editHandler({
          bookSourceComment: "",
          bookSourceGroup: "",
          bookSourceName: "新增书源",
          bookSourceType: 0,
          bookSourceUrl: "",
          bookUrlPattern: "",
          enabled: true,
          enabledExplore: true,
          exploreUrl: "",
          ruleBookInfo: {},
          ruleContent: {
            content: ""
          },
          ruleExplore: {},
          ruleSearch: {
            author: "",
            bookList: "",
            bookUrl: "",
            coverUrl: "",
            intro: "",
            kind: "",
            lastChapter: "",
            name: ""
          },
          ruleToc: {
            chapterList: "",
            chapterName: "",
            chapterUrl: ""
          },
          searchUrl: ""
        });
        return;
      }
      Axios.post(this.api + "/getSource", {
        bookSourceUrl: bookSource.bookSourceUrl
      }).then(
        res => {
          if (res.data.isSuccess) {
            //
            editHandler(res.data.data);
          }
        },
        error => {
          this.$message.error(
            "加载书源信息失败 " + (error && error.toString())
          );
        }
      );
    },
    editRssSource(rssSource) {
      rssSource = rssSource || {
        sourceName: "新增RSS源",
        sourceUrl: "",
        sourceIcon: "",
        sourceGroup: "",
        enabled: true,
        singleUrl: true,
        articleStyle: 0,
        ruleArticles: "",
        ruleTitle: "",
        rulePubDate: "",
        ruleImage: "",
        ruleLink: "",
        ruleContent: "",
        enableJs: true
      };
      eventBus.$emit(
        "showEditor",
        "编辑RSS源",
        JSON.stringify(rssSource, null, 4),
        (content, close) => {
          try {
            const source = JSON.parse(content);
            if (!source.sourceName) {
              this.$message.error("RSS源名称不能为空");
              return;
            }
            if (!source.sourceUrl) {
              this.$message.error("RSS源链接不能为空");
              return;
            }
            Axios.post(this.api + "/saveRssSource", source).then(
              res => {
                if (res.data.isSuccess) {
                  //
                  close();
                  this.$message.success("保存RSS源成功");
                  this.loadRssSources(true);
                }
              },
              error => {
                this.$message.error(
                  "保存RSS源失败 " + (error && error.toString())
                );
              }
            );
          } catch (e) {
            this.$message.error("RSS源必须是JSON格式");
          }
        }
      );
    },
    updateForce() {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistrations()
          .then(async function(registrations) {
            /* eslint-disable-next-line no-console */
            console.log("registrations", registrations);
            for (let i = 0; i < registrations.length; i++) {
              await registrations[i].update();
            }

            /* eslint-disable-next-line no-console */
            console.log("Try to clear home cache");
            navigator.serviceWorker.controller &&
              navigator.serviceWorker.controller.postMessage({
                type: "CLEAR_HOME_CACHE"
              });

            /* eslint-disable-next-line no-console */
            console.log("Try to skip waiting");
            navigator.serviceWorker.controller &&
              navigator.serviceWorker.controller.postMessage({
                type: "SKIP_WAITING"
              });

            setTimeout(() => {
              /* eslint-disable-next-line no-console */
              console.log("Try to reload force");
              window.location.reload(true);
            }, 50);
          });
      }
    },
    async scanCacheStorage() {
      this.localCacheStats = {
        total: (await this.analyseLocalStorage()).totalBytes,
        bookSourceList: (await this.analyseLocalStorage("bookSourceList"))
          .totalBytes,
        rssSources: (await this.analyseLocalStorage("rssSources")).totalBytes,
        chapterList: (await this.analyseLocalStorage("chapterList")).totalBytes,
        chapterContent: (await this.analyseLocalStorage("chapterContent"))
          .totalBytes
      };
    },
    analyseLocalStorage(match) {
      let totalBytes = 0;
      let cacheBytes = 0;
      return window.$cacheStorage
        .iterate(function(value, key) {
          if (!match || key.indexOf(match) >= 0) {
            totalBytes += JSON.stringify(value).getBytesLength();
            if (key.startsWith("localCache@")) {
              cacheBytes += JSON.stringify(value).getBytesLength();
            }
          }
        })
        .then(() => {
          return {
            totalBytes: formatSize(totalBytes),
            cacheBytes: formatSize(cacheBytes)
          };
        })
        .catch(function() {
          // 当出错时，此处代码运行
          // console.log(err);
        });
    },
    clearCache(match) {
      let cacheBytes = 0;
      window.$cacheStorage
        .iterate(function(value, key) {
          if (!match || key.indexOf(match) >= 0) {
            if (key.startsWith("localCache@")) {
              cacheBytes += JSON.stringify(value).getBytesLength();
              window.$cacheStorage.removeItem(key);
            }
          }
        })
        .then(() => {
          this.scanCacheStorage();

          return {
            cacheBytes: formatSize(cacheBytes)
          };
        })
        .catch(function() {
          // 当出错时，此处代码运行
          // console.log(err);
        });
    },
    scrollHandler() {
      this.lastScrollTop = this.$refs.bookList.scrollTop;
    },
    getBookCoverUrl(book) {
      return book.customCoverUrl || book.coverUrl;
    },
    logout() {
      Axios.post(this.api + "/logout").then(
        res => {
          if (res.data.isSuccess) {
            this.$store.commit("setToken", "");
            window.location.reload(true);
          }
        },
        error => {
          this.$message.error("注销失败 " + (error && error.toString()));
        }
      );
    },
    getChapterListByRule() {
      return Axios.post("/getChapterListByRule", this.importBookInfo).then(
        res => {
          if (res.data.isSuccess && res.data.data.book) {
            this.importBookInfo = res.data.data.book;
            this.importBookChapters = res.data.data.chapters;
          }
        },
        error => {
          this.$message.error("注销失败 " + (error && error.toString()));
        }
      );
    },
    showUserManageDialog() {
      eventBus.$emit("showUserManageDialog");
    },
    showMPCode() {
      eventBus.$emit("showMPCodeDialog");
    },
    joinTGChannel() {
      window.open("https://t.me/facker_channel", "_target");
    },
    ensureLoadBookCover() {
      // 手动触发滚动事件，显示书籍封面图片
      this.$refs.bookList.dispatchEvent(new MouseEvent("scroll"));

      // 上面一步应该能搞定，下面再确认一下
      this.$refs.bookCoverList.forEach(v => {
        if (!v.show && isInContainer(v.$el, this.$refs.bookList)) {
          // console.log("not show ", v);
          v.show = true;
        }
      });
    }
  },
  computed: {
    ...mapGetters([
      "collapseMenu",
      "dialogWidth",
      "dialogSmallWidth",
      "dialogTop",
      "dialogContentHeight",
      "popupWidth"
    ]),
    config() {
      return this.$store.getters.config;
    },
    isNight() {
      return this.$store.getters.isNight;
    },
    themeColor() {
      if (this.$store.getters.isNight) {
        return {
          background: "#f7f7f7"
        };
      } else {
        return {
          background: "#222"
        };
      }
    },
    bookList() {
      return this.isSearchResult ? this.searchResult : this.showShelfBooks;
    },
    bookCoverList() {
      return this.bookList
        .filter(v => this.getBookCoverUrl(v))
        .map(v => this.getCover(this.getBookCoverUrl(v), true));
    },
    shelfBooks() {
      return this.$store.getters.shelfBooks;
    },
    showShelfBooks() {
      return this.getShowShelfBooks(this.showBookGroup);
    },
    searchResultMap() {
      return this.searchResult.reduce((c, v) => {
        c[v.bookUrl] = v;
        return c;
      }, {});
    },
    connectStatus() {
      return this.$store.state.connected
        ? `后端已连接`
        : this.connecting
        ? "正在连接后端服务器……"
        : "点击设置后端接口前缀";
    },
    connectType() {
      return this.$store.state.connected ? "success" : "danger";
    },
    readingRecent() {
      return this.$store.state.readingBook &&
        this.$store.state.readingBook.bookName
        ? this.$store.state.readingBook
        : {
            bookName: "尚无阅读记录",
            bookUrl: "",
            index: 0
          };
    },
    loginAuth() {
      return this.$store.state.loginAuth;
    },
    bookSourceList() {
      return this.$store.state.bookSourceList;
    },
    userNS: {
      get() {
        return this.$store.state.userNS;
      },
      set(val) {
        this.$store.commit("setUserNS", val);
        if (val) {
          this.$store.commit("setIsManagerMode", true);
        }
      }
    },
    userList: {
      get() {
        return this.$store.state.userList;
      },
      set(val) {
        this.$store.commit("setUserList", val);
      }
    },
    bookSourceShowList() {
      return this.isShowFailureBookSource
        ? this.$store.state.failureBookSource
        : this.bookSourceList;
    },
    bookSourceGroupList() {
      const groupsMap = {};
      this.bookSourceList.forEach(v => {
        if (v.bookSourceGroup) {
          groupsMap[v.bookSourceGroup] = (groupsMap[v.bookSourceGroup] | 0) + 1;
        }
      });
      const groups = [
        {
          name: "全部分组",
          value: "",
          count: this.bookSourceList.length
        }
      ];
      for (const i in groupsMap) {
        if (Object.hasOwnProperty.call(groupsMap, i)) {
          groups.push({
            name: i,
            value: i,
            count: groupsMap[i]
          });
        }
      }
      return groups;
    },
    bookSourceShowGroup() {
      if (!this.isShowFailureBookSource) {
        const groups = new Set();
        this.bookSourceShowList.forEach(v => {
          v.bookSourceGroup && groups.add(v.bookSourceGroup);
        });
        groups.add("未分组");
        return Array.from(groups);
      } else {
        return [].concat(errorTypeList).concat(["timeout"]);
      }
    },
    bookSourceShowLength() {
      return this.bookSourceShowResult.length;
    },
    bookSourceShowResult() {
      if (!this.showSourceGroup) {
        return this.bookSourceShowList;
      }
      if (this.isShowFailureBookSource) {
        return this.bookSourceShowList.filter(v =>
          this.showSourceGroup
            ? v.errorMsg.indexOf(this.showSourceGroup) >= 0
            : true
        );
      } else {
        return this.bookSourceShowList.filter(v =>
          this.showSourceGroup === "未分组"
            ? !v.bookSourceGroup
            : v.bookSourceGroup === this.showSourceGroup
        );
      }
    },
    bookSourceShowResultPageList() {
      const start =
        (this.bookSourcePagination.page - 1) * this.bookSourcePagination.size;
      if (start > this.bookSourceShowResult.length) {
        return [];
      }
      return this.bookSourceShowResult.slice(
        start,
        Math.min(
          start + this.bookSourcePagination.size,
          this.bookSourceShowResult.length
        )
      );
    },
    showBookGroup: {
      get() {
        if (!this.bookGroupDisplayList.length) return -1;
        return this.$store.state.shelfConfig.showBookGroup;
      },
      set(val) {
        this.$store.commit("setShelfConfig", {
          ...this.$store.state.shelfConfig,
          showBookGroup: val
        });
      }
    },
    bookGroupDisplayList() {
      return this.$store.state.bookGroupList
        .filter(v => this.getShowShelfBooks(v.groupId).length && v.show)
        .sort((a, b) => a.order - b.order);
    },
    rssSourceList() {
      return []
        .concat(this.$store.state.rssSourceList)
        .sort((a, b) => a.customOrder - b.customOrder);
    },
    rssArticleImageList() {
      return this.rssArticleList
        .filter(v => v.image)
        .map(v => this.getImage(v.image, true, true));
    },
    searchConfig: {
      get() {
        return this.$store.state.searchConfig;
      },
      set(val) {
        this.$store.commit("setSearchConfig", val);
      }
    },
    isShowTocRule() {
      try {
        return (
          this.importBookInfo &&
          this.importBookInfo.originName &&
          this.importBookInfo.originName.toLowerCase().endsWith(".txt")
        );
      } catch (e) {
        // console.log(e);
      }
      return false;
    }
  }
};
</script>

<style lang="stylus" scoped>
.index-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;

  .navigation-wrapper {
    width: 260px;
    min-width: 260px;
    height: 100%;
    box-sizing: border-box;
    background-color: #F7F7F7;
    position: relative;
    padding-top: 0;
    padding-top: constant(safe-area-inset-top) !important;
    padding-top: env(safe-area-inset-top) !important;

    .navigation-inner-wrapper {
      padding: 48px 36px 66px 36px;
      height: 100%;
      overflow-y: auto;
      box-sizing: border-box;
    }

    .navigation-title {
      font-size: 24px;
      font-weight: 600;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;

      .version-text {
        float: right;
        font-size: 14px;
        line-height: 33px;
        font-weight: 400;
        color: #b1b1b1;
        display: inline-block;
        cursor: pointer;
      }
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 500;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      margin-top: 16px;
      color: #b1b1b1;
    }

    .search-wrapper {
      .search-input {
        border-radius: 50%;
        margin-top: 24px;

        >>> .el-input__inner {
          border-radius: 50px;
          border-color: #E3E3E3;
        }
      }
    }

    .recent-wrapper {
      margin-top: 36px;

      .recent-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      }

      .reading-recent {
        margin: 18px 0;

        .recent-book {
          cursor: pointer;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;

        .right-text {
          float: right;
          display: inline-block;
          height: 20px;
          line-height: 20px;
          cursor: pointer;
          user-select: none;
        }
      }

      .no-point {
        pointer-events: none;
      }

      .setting-connect {
        cursor: pointer;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .setting-item {
        padding-top: 16px;
      }

      .setting-btn {
        margin-right: 15px;
        margin-bottom: 15px;
        cursor: pointer;
      }

      .setting-select {
        width: 100%;
      }
    }

    .search-setting {
      margin-top: 28px;
    }

    .bottom-icons {
      position: absolute;
      bottom: 30px;
      width: 188px;
      left: 36px;
      align-items: center;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      pointer-events: none;

      .bottom-icon {
        height: 36px;
        pointer-events: all;
        img {
          width: 36px;
          height: 36px;
        }
      }

      .theme-item {
        line-height: 32px;
        width: 36px;
        height: 36px;
        border-radius: 100%;
        display: inline-block;
        cursor: pointer;
        text-align: center;
        vertical-align: middle;
        pointer-events: all;

        .el-icon-moon {
          color: #f7f7f7;
          line-height: 34px;
        }
        .el-icon-sunny {
          color: #121212;
          line-height: 34px;
        }
      }
    }

    .setting-wrapper:nth-last-child(1) {
      padding-bottom: 20px;
    }
  }

  .shelf-wrapper {
    padding: 48px 48px;
    height: 100%;
    max-height: 100%;
    width: 100%;
    background-color: #fff;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;

    .shelf-title {
      font-size: 20px;
      font-weight: 600;
      font-family: -apple-system, "Noto Sans", "Helvetica Neue", Helvetica, "Nimbus Sans L", Arial, "Liberation Sans", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Source Han Sans CN", "Microsoft YaHei", "Wenquanyi Micro Hei", "WenQuanYi Zen Hei", "ST Heiti", SimHei, "WenQuanYi Zen Hei Sharp", sans-serif;
      margin-bottom: 5px;
      min-width: 320px;
      box-sizing: border-box;

      .el-icon-menu {
        cursor: pointer;
      }

      .title-btn {
        font-size: 14px;
        line-height: 28px;
        float: right;
        cursor: pointer;
        user-select: none;
        margin-left: 10px;

        >>>.el-icon-loading {
          font-size: 16px;
        }
      }
    }

    >>>.el-icon-loading {
      font-size: 36px;
      color: #B5B5B5;
    }

    >>>.el-loading-text {
      font-weight: 500;
      color: #B5B5B5;
    }

    .book-group-wrapper {
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      padding: 5px 0;
      margin-bottom: 10px;

      .book-group-btn {
        margin-right: 10px;
        cursor: pointer;
      }

      .book-group-btn.selected {
        color: #fff;
        background: #409EFF;
        border-color: #409EFF;
      }
    }

    .books-wrapper {
      flex: 1;
      overflow-x: hidden;
      overflow-y: scroll;

      .wrapper {
        display: grid ;
        grid-template-columns: repeat(auto-fill, 380px);
        justify-content: space-around;
        grid-gap: 10px;

        .book {
          user-select: none;
          display: flex;
          cursor: pointer;
          margin-bottom: 18px;
          padding: 24px 24px;
          width: 360px;
          flex-direction: row;
          justify-content: space-around;

          .cover-img {
            width: 84px;
            height: 112px;

            .cover {
              width: 84px;
              height: 112px;
            }
          }

          .info {
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: left;
            height: 112px;
            margin-left: 20px;
            flex: 1;

            .book-operation {
              position: absolute;
              right: 5px;
              top: 0px;
              font-size: 24px;
              color: #969ba3;

              i {
                margin-left: 10px;
              }
            }

            .name {
              width: fit-content;
              font-size: 16px;
              font-weight: 700;
              color: #33373D;
              margin-right: 38px;
              max-height: 45px;
              word-wrap: break-word;
              overflow: hidden;
              text-overflow: ellipsis;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 2;
            }

            .name.edit {
              margin-right: 62px;
            }

            .sub {
              display: flex;
              flex-direction: row;
              font-size: 12px;
              font-weight: 600;
              color: #969ba3;

              .dot {
                margin: 0 7px;
              }
            }

            .intro, .dur-chapter, .last-chapter {
              color: #6b6b6b;
              font-size: 13px;
              margin-top: 3px;
              font-weight: 500;
              word-wrap: break-word;
              overflow: hidden;
              text-overflow: ellipsis;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              text-align: left;
            }
          }
        }
      }

      .wrapper:last-child {
        margin-right: auto;
      }
    }

    .books-wrapper::-webkit-scrollbar {
      width: 0 !important;
    }
  }
}

.unread-num-badge {
  >>>.el-badge__content {
    border: none;
  }
}

.night {
  >>>.navigation-wrapper {
    background-color: #121212;
    border-right: 1px solid #555;
  }
  >>>.navigation-title {
    color: #bbb;
  }
  >>>.shelf-title {
    color: #bbb;
  }
  >>>.shelf-wrapper {
    background-color: #222;
  }
  >>>.el-input__inner {
    background-color: #444;
    border: 1px solid #444 !important;
    color: #aaa;
  }
  .book .info .name {
    color: #bbb !important;
  }
  .book .info .book-operation {
    color: #6b6b6b !important;
  }
  .book .info .sub {
    color: #6b6b6b !important;
  }
  .book .info .intro, .book .info .dur-chapter, .book .info .last-chapter {
    color: #969ba3 !important;
  }

  >>>.check-tip {
    color: #bbb;
  }
}

.source-container {
  // max-height: 400px;
  // overflow-y: auto;
  padding: 0 10px;

  &.table-container {
    padding: 0;
  }

  .check-form {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    align-items: center;

    .check-form-label {
      min-width: 60px;
    }

    .el-input {
      width: auto;
      min-width: 100px;
      margin-right: 10px;
    }

    .el-input-number {
      min-width: 130px;
      margin-right: 10px;
    }

    .book-cover {
      width: 84px;
      height: 112px;

      .cover {
        width: 84px;
        height: 112px;
      }
    }

    .book-info {
      display: flex;
      flex-direction: column;
      margin-left: 30px;
      justify-content: space-between;
      min-height: 100px;

      .toc-refresh-btn {
        margin-left: 5px;
      }

      span {
        display: inline-block;
        min-width: 56px;
        text-align-last: justify;
      }
      .el-input {
        width: auto;
        min-width: 100px;
        margin-right: 10px;
      }
      .el-input-number {
        min-width: 130px;
        margin-right: 10px;
      }
    }
  }

  .chapter-title {
    font-size: 15px;
    padding: 5px 0;
    font-weight: 600;
    margin-top: 10px;
  }

  .chapter-list {
    overflow-y: auto;
    box-sizing: border-box;
    padding: 0 5px;

    p {
      margin-top: 0.4em;
      margin-bottom: 0.4em;
    }
  }

  .source-group-wrapper {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    padding: 5px 0;

    .source-group-btn {
      margin-right: 10px;
      cursor: pointer;
    }

    .source-group-btn.selected {
      color: #fff;
      background: #409EFF;
      border-color: #409EFF;
    }
  }

  .el-pagination {
    margin-top: 8px;
    float: right;
    max-width: 100%;
    overflow-x: auto;
    box-sizing: border-box;
  }

  >>>.source-checkbox {
    display: block;
    padding: 8px 0;
    width: 100%;
  }

  pre {
    margin: 0;
  }

  .source-pagination::after {
    display: table;
    content: "";
    clear: both;
  }
}

.source-list-container {
  max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px - 66px);
  overflow-y: auto;
  overflow-x: auto;
}

.rss-source-list-container {
  max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px);
  overflow-y: auto;

  .rss-source {
    display: inline-block;
    width: 25%;
    box-sizing: border-box;
    padding: 10px;
    position: relative;
    text-align: center;
    vertical-align: top;
    margin-bottom: 10px;
    cursor: pointer;
    position: relative;

    .el-icon-close {
      position: absolute;
      right: 6px;
      top: 8px;
      font-size: 18px;
    }

    .el-icon-edit {
      position: absolute;
      right: 6px;
      top: 42px;
      font-size: 18px;
    }

    .rss-icon {
      display: inline-block;
      width: 50px;
      height: 50px;
      border-radius: 5px;
    }
    .rss-title {
      margin-top: 5px;
      text-align: center;
    }
  }
}

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

.rss-article-info-container {
  max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px);
  overflow-y: auto;
}

.night {
  .source-container {
    .source-group-wrapper {
      .source-group-btn.selected {
        color: #fff;
        background: #185798;
        border-color: #185798;
      }
    }
  }
  .book-group-wrapper {
    .book-group-btn.selected {
      color: #fff;
      background: #185798 !important;
      border-color: #185798 !important;
    }
  }

  .rss-source-list-container {
    .rss-source {
      .rss-title {
        color: #aaa;
      }
    }
  }

  .rss-article-list-container {
    .rss-article {
      border-color: #333;
      color: #aaa;

      .rss-article-date {
        color: #666;
      }
    }
  }
  .rss-article-content {
    color: #aaa;
  }
}

.source-container::-webkit-scrollbar {
  width: 0 !important;
}
.navigation-inner-wrapper::-webkit-scrollbar {
  width: 0 !important;
}
>>> .el-table__body-wrapper::-webkit-scrollbar {
  width: 0 !important;
}
>>> .el-dialog__wrapper::-webkit-scrollbar {
  width: 0 !important;
}
@media screen and (max-width: 750px) {
  .index-wrapper {
    overflow-x: hidden;

    >>>.navigation-wrapper {
      .navigation-inner-wrapper {
        padding: 20px 36px 66px 36px;
      }
    }
    >>>.shelf-wrapper {
      padding: 0;
      padding-top: constant(safe-area-inset-top) !important;
      padding-top: env(safe-area-inset-top) !important;

      .shelf-title {
        padding: 20px 24px 0 24px;
      }

      .book-group-wrapper {
        margin-left: 24px;
        margin-right: 24px;
      }

      .books-wrapper {
        .wrapper {
          display: flex;
          flex-direction: column;

          .book {
            box-sizing: border-box;
            width: 100%;
            margin-bottom: 0;
            padding: 10px 20px;
          }
        }
      }
    }
  }
  .rss-source-list-container {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px);
  }
  .rss-article-list-container {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px);

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
  .rss-article-info-container {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px);
  }
  .source-list-container  {
    max-height: calc(var(--vh, 1vh) * 100 - 54px - 40px - 66px);
  }
}
@media screen and (max-width: 480px) {
  .source-container.table-container {
    margin: -15px -5px;
  }
  .rss-source-list-container {
    .rss-source {
      .el-icon-close {
        right: -5px;
      }

      .el-icon-edit {
        right: -5px;
      }
    }
  }
}
</style>
<style>
.navigation-hidden {
  margin-left: -260px;
}
.navigation-in {
  margin-left: 0px;
  transition: margin-left 0.3s;
}
.navigation-out {
  margin-left: -260px;
  transition: margin-left 0.3s;
}
.popper-intro {
  padding: 15px;
}
.book-kind span {
  display: inline-block;
  margin-left: 5px;
  margin-right: 5px;
}
.night-theme .popper-intro {
  background: #121212;
  color: #bbb !important;
  border: none;
}
.night-theme .popper-intro.el-popper[x-placement^="bottom"] .popper__arrow,
.night-theme
  .popper-intro.el-popper[x-placement^="bottom"]
  .popper__arrow::after {
  border-bottom-color: #121212 !important;
}
.night-theme .popper-intro.el-popper[x-placement^="top"] .popper__arrow,
.night-theme .popper-intro.el-popper[x-placement^="top"] .popper__arrow::after {
  border-top-color: #121212 !important;
}
.night-theme .el-popover__title {
  color: #ddd !important;
}
.status-bar-light-bg {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.2) 0,
    transparent 36px
  ) !important;
}
.status-bar-light-bg-dialog .el-dialog.is-fullscreen {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.2) 0,
    transparent 36px
  ) !important;
}
.rss-article-info-container img {
  max-width: 100%;
}
.rss-article-info-container video {
  max-width: 100%;
}
@media (hover: hover) {
  .book:hover {
    background: rgba(0, 0, 0, 0.1);
    transition-duration: 0.5s;
  }
  .el-icon-close:hover {
    color: #409eff;
  }
  .el-icon-edit:hover {
    color: #409eff;
  }
}

.mini-interface .el-dialog__body {
  padding: 15px 20px;
}
</style>
