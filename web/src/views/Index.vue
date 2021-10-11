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
    >
      <div class="navigation-inner-wrapper">
        <div class="navigation-title">
          阅读
          <span class="version-text">{{ $store.state.version }}</span>
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
            搜索书源
          </div>
          <div class="setting-item">
            <el-select
              size="mini"
              v-model="bookSourceUrl"
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
              @change="onBookSourceFileChange"
              style="display:none"
            />
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
            用户空间
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
              @click="showUserManageDialog = true"
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
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <div class="shelf-title">
        <i
          class="el-icon-menu"
          v-if="collapseMenu"
          @click.stop="toggleMenu"
        ></i>
        {{ isSearchResult ? (isExploreResult ? "探索" : "搜索") : "书架" }}
        ({{ bookList.length }})
        <div class="title-btn" v-if="isSearchResult" @click="backToShelf">
          书架
        </div>
        <div class="title-btn" v-if="isSearchResult" @click="loadMore">
          <i class="el-icon-loading" v-if="loadingMore"></i>
          {{ loadingMore ? "加载中..." : "加载更多" }}
        </div>
        <div
          class="title-btn"
          v-else-if="!isSearchResult"
          @click="refreshShelf"
        >
          <i class="el-icon-loading" v-if="refreshLoading"></i>
          {{ refreshLoading ? "刷新中..." : "刷新" }}
        </div>
        <div class="title-btn" v-if="!isSearchResult" @click="importLocalBook">
          导入
          <input
            ref="bookRef"
            type="file"
            @change="onBookFileChange"
            style="display:none"
          />
        </div>
        <div
          class="title-btn"
          @click="showExplorePop"
          v-if="!(isSearchResult && !isExploreResult)"
        >
          书海
        </div>
      </div>
      <div class="book-group-wrapper">
        <el-tag
          type="info"
          :effect="$store.getters.isNight ? 'dark' : 'light'"
          class="book-group-btn"
          :class="showBookGroup === group.groupId ? 'selected' : ''"
          v-for="group in $store.state.bookGroupList"
          :key="'bookGroup-' + group.groupId"
          @click="showBookGroup = group.groupId"
          v-show="getShowShelfBooks(group.groupId).length"
        >
          {{ group.groupName }}
        </el-tag>
        <el-tag
          type="info"
          :effect="$store.getters.isNight ? 'dark' : 'light'"
          class="book-group-btn"
          :key="'bookGroup-manage'"
          v-if="$store.state.bookGroupList.length"
          @click="showManageBookGroup"
        >
          管理
        </el-tag>
      </div>
      <div class="books-wrapper" ref="bookList">
        <div class="wrapper">
          <div
            class="book"
            :style="showNavigation ? { minWidth: '360px !important' } : {}"
            v-for="book in bookList"
            :key="book.bookUrl"
            @click="toDetail(book)"
          >
            <div class="cover-img" @click.stop="toggleBookIntroPop(book)">
              <img class="cover" v-lazy="getCover(book.coverUrl)" alt="" />
            </div>
            <div class="info" @click="toDetail(book)">
              <div class="book-operation">
                <i
                  class="el-icon-close"
                  v-if="!isSearchResult"
                  @click.stop="deleteBook(book)"
                ></i>
              </div>
              <div class="name" slot="reference">
                {{ book.name }}
              </div>
              <div class="sub">
                <div class="author">
                  {{ book.author }}
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
      title="导入书源"
      :visible.sync="showImportDialog"
      :width="dialogWidth"
      :top="dialogTop"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg' : ''"
    >
      <div class="source-container">
        <el-checkbox-group
          v-model="checkedSourceIndex"
          @change="handleCheckedSourcesChange"
        >
          <el-checkbox
            v-for="(source, index) in importBookSource"
            :label="index"
            :key="index"
            class="source-checkbox"
            >{{ source.bookSourceName }} {{ source.bookSourceUrl }}</el-checkbox
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
        <el-button size="medium" @click="showImportDialog = false"
          >取消</el-button
        >
        <el-button size="medium" type="primary" @click="saveBookSourceList"
          >确定</el-button
        >
      </div>
    </el-dialog>
    <el-dialog
      :title="isShowFailureBookSource ? '失效书源管理' : '书源管理'"
      :visible.sync="showBookSourceManageDialog"
      :width="dialogWidth"
      :top="dialogTop"
      @closed="
        isShowFailureBookSource = false;
        showSourceGroup = '';
      "
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
    >
      <div class="source-container table-container">
        <div class="check-form" v-if="isShowFailureBookSource">
          <span>搜索词：</span>
          <el-input v-model="checkBookSourceConfig.keyword" size="small">
          </el-input>
          <span style="min-width: 68px;">超时(ms)：</span>
          <el-input-number
            v-model="checkBookSourceConfig.timeout"
            :min="1000"
            :max="15000"
            :step="500"
            size="small"
          >
          </el-input-number>
          <span>并发数：</span>
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
      title="用户管理"
      :visible.sync="showUserManageDialog"
      :width="dialogWidth"
      :top="dialogTop"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
    >
      <div class="source-container table-container">
        <el-table
          :data="userList"
          :height="dialogContentHeight"
          @selection-change="manageUserSelection = $event"
        >
          <el-table-column
            type="selection"
            width="25"
            :selectable="isUserSelectable"
            fixed
          >
          </el-table-column>
          <el-table-column
            property="username"
            label="用户名"
            min-width="100"
            fixed
          ></el-table-column>
          <el-table-column
            property="lastLoginAt"
            label="上次登录"
            :formatter="formatTableField"
            min-width="120"
          ></el-table-column>
          <el-table-column
            property="createdAt"
            label="注册时间"
            :formatter="formatTableField"
            min-width="120"
          ></el-table-column>
          <el-table-column
            property="enableWebdav"
            label="WebDAV"
            min-width="80"
          >
            <template slot-scope="scope">
              <el-switch
                v-if="scope.row.userNS !== 'default'"
                v-model="scope.row.enableWebdav"
                active-color="#13ce66"
                inactive-color="#ff4949"
                :active-value="true"
                :inactive-value="false"
                @change="toggleUserWebdav(scope.row, $event)"
              >
              </el-switch>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div slot="footer" class="dialog-footer">
        <el-button
          type="primary"
          size="medium"
          class="float-left"
          @click="deleteUserList"
          >批量删除</el-button
        >
        <span class="check-tip"
          >已选择 {{ manageUserSelection.length }} 个</span
        >
        <el-button size="medium" @click="showUserManageDialog = false"
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
      title="导入本地书籍"
      :visible.sync="showImportBookDialog"
      :width="dialogWidth"
      :top="dialogTop"
      @closed="importBookDialogClosed"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
    >
      <div class="source-container table-container">
        <div class="check-form">
          <span>书名：</span>
          <el-input v-model="importBookInfo.name" size="small"> </el-input>
          <span style="min-width: 68px;">作者：</span>
          <el-input v-model="importBookInfo.author" size="small"> </el-input>
        </div>
        <div class="chapter-title">
          章节列表({{ importBookChapters.length }})
        </div>
        <div
          class="chapter-list"
          :style="{ maxHeight: dialogContentHeight - 40 - 35 + 'px' }"
        >
          <p v-for="(chapter, index) in importBookChapters" :key="index">
            {{ chapter.title }}
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
      :title="isShowBookGroupSettingDialog ? '设置分组' : '分组管理'"
      :visible.sync="showBookGroupManageDialog"
      :width="dialogWidth"
      :top="dialogTop"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
      @opened="$refs.bookGroupTableRef.doLayout()"
      @closed="isShowBookGroupSettingDialog = false"
    >
      <div class="source-container table-container">
        <el-table
          :data="showBookGroupList"
          :height="dialogContentHeight"
          @selection-change="bookGroupSelection = $event"
          ref="bookGroupTableRef"
          :key="isShowBookGroupSettingDialog"
        >
          <el-table-column
            type="selection"
            width="25"
            fixed
            v-if="isShowBookGroupSettingDialog"
          >
          </el-table-column>
          <el-table-column
            property="groupName"
            label="分组名"
            min-width="100"
            fixed
          >
            <template slot-scope="scope">
              <span> {{ displayBookGroupName(scope.row) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            property="show"
            label="显示"
            min-width="80"
            v-if="!isShowBookGroupSettingDialog"
          >
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.show"
                active-color="#13ce66"
                inactive-color="#ff4949"
                :active-value="true"
                :inactive-value="false"
                @change="toggleBookGroupShow(scope.row, $event)"
              >
              </el-switch>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100px">
            <template slot-scope="scope">
              <el-button
                type="text"
                v-if="
                  !isShowBookGroupSettingDialog &&
                    scope.row.groupId > 0 &&
                    !getShowShelfBooks(scope.row.groupId).length
                "
                @click="deleteBookGroup(scope.row)"
                style="color: #f56c6c"
                >删除</el-button
              >
              <el-button type="text" @click="saveBookGroup(scope.row)"
                >编辑</el-button
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
          @click="saveBookGroup()"
          >添加分组</el-button
        >
        <el-button
          type="primary"
          size="medium"
          @click="setBookGroup"
          v-if="isShowBookGroupSettingDialog"
          >确认</el-button
        >
        <el-button size="medium" @click="showBookGroupManageDialog = false"
          >取消</el-button
        >
      </div>
    </el-dialog>

    <el-dialog
      title="书籍信息"
      :visible.sync="showBookInfoDialog"
      :width="dialogSmallWidth"
      :fullscreen="collapseMenu"
      :class="isWebApp && !isNight ? 'status-bar-light-bg-dialog' : ''"
    >
      <div class="book-info-container">
        <div class="book-cover">
          <div class="book-cover-bg" :style="bookCoverBgStyle"></div>
          <div class="book-cover-bg-image">
            <img
              v-lazy="getCover(showBookInfo.coverUrl)"
              :key="showBookInfo.name"
              alt=""
            />
          </div>
        </div>
        <div class="book-name">{{ showBookInfo.name }}</div>
        <div class="book-kind">{{ showBookInfo.kind }}</div>
        <div class="book-props">
          <div class="book-prop book-author">
            作者： {{ showBookInfo.author || "未知" }}
          </div>
          <div class="book-prop book-origin">
            来源： {{ displayOriginName(showBookInfo.origin) }}
          </div>
          <div class="book-prop book-latest">
            最新： {{ showBookInfo.latestChapterTitle }}
          </div>
          <div class="book-prop book-group" v-if="!isSearchResult">
            分组： {{ displayGroupName(showBookInfo.group) }}
            <el-button
              type="text"
              class="book-prop-btn"
              @click="showSetBookGroup()"
              >设置分组</el-button
            >
          </div>
        </div>
        <div class="book-intro" v-html="renderBookIntro(showBookInfo)"></div>
      </div>
    </el-dialog>
  </div>
</template>

<script>
import Explore from "../components/Explore.vue";
import Axios from "../plugins/axios";
import { errorTypeList } from "../plugins/config";

Date.prototype.format = function(fmt) {
  var o = {
    "M+": this.getMonth() + 1, //月份
    "d+": this.getDate(), //日
    "h+": this.getHours(), //小时
    "m+": this.getMinutes(), //分
    "s+": this.getSeconds(), //秒
    "q+": Math.floor((this.getMonth() + 3) / 3), //季度
    S: this.getMilliseconds() //毫秒
  };
  if (/(y+)/.test(fmt)) {
    fmt = fmt.replace(
      RegExp.$1,
      (this.getFullYear() + "").substr(4 - RegExp.$1.length)
    );
  }
  for (var k in o) {
    if (new RegExp("(" + k + ")").test(fmt)) {
      fmt = fmt.replace(
        RegExp.$1,
        RegExp.$1.length == 1 ? o[k] : ("00" + o[k]).substr(("" + o[k]).length)
      );
    }
  }
  return fmt;
};
const formatSize = function(value, scale) {
  if (value == null || value == "") {
    return "0 Bytes";
  }
  var unitArr = new Array(
    "Bytes",
    "KB",
    "MB",
    "GB",
    "TB",
    "PB",
    "EB",
    "ZB",
    "YB"
  );
  var index = 0;
  index = Math.floor(Math.log(value) / Math.log(1024));
  var size = value / Math.pow(1024, index);
  size = size.toFixed(scale || 2);
  return size + " " + unitArr[index];
};
const LimitResquest = function(limit, process) {
  let currentSum = 0;
  let requests = [];

  async function run() {
    let err, result;
    try {
      ++currentSum;
      handler.leftCount = requests.length;
      const fn = requests.shift();
      result = await fn();
    } catch (error) {
      err = error;
      // console.log("Error", err);
      handler.errorCount++;
    } finally {
      --currentSum;
      handler.requestCount++;
      handler.leftCount = requests.length;
      process && process(handler, result, err);
      if (requests.length > 0) {
        run();
      }
    }
  }

  const handler = reqFn => {
    if (!reqFn || !(reqFn instanceof Function)) {
      return;
    }
    requests.push(reqFn);
    handler.leftCount = requests.length;
    if (currentSum < limit) {
      run();
    }
  };

  handler.requestCount = 0;
  handler.leftCount = 0;
  handler.errorCount = 0;
  handler.cancel = () => {
    requests = [];
  };

  return handler;
};
export default {
  components: {
    Explore
  },
  data() {
    return {
      search: "",
      bookSourceUrl: "",
      isSearchResult: false,
      isExploreResult: false,
      searchResult: [],
      searchPage: 1,
      refreshLoading: false,
      popExploreVisible: false,
      loadingMore: false,
      importBookSource: [],
      showImportDialog: false,
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

      showUserManageDialog: false,
      manageUserSelection: [],

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

      showBookGroup: -1,
      showBookGroupManageDialog: false,
      isShowBookGroupSettingDialog: false,
      bookGroupSelection: [],

      showBookInfo: {},
      showBookInfoDialog: false
    };
  },
  watch: {
    bookSourceUrl(val) {
      window.localStorage && window.localStorage.setItem("bookSourceUrl", val);
      if (this.isSearchResult && val) {
        this.searchBook(1);
      }
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
    }
  },
  mounted() {
    document.title = "阅读";
    this.bookSourceUrl =
      (window.localStorage && window.localStorage.getItem("bookSourceUrl")) ||
      "";
    this.navigationClass =
      this.collapseMenu && !this.showNavigation ? "navigation-hidden" : "";
    window.shelfPage = this;
    this.init();
  },
  activated() {
    document.title = "阅读";
  },
  methods: {
    init(refresh) {
      if (this.initing) return;
      this.initing = true;
      if (!refresh) {
        if (this.shelfBooks.length) {
          // 加载书源列表
          this.loadBookSource(refresh);
          // 加载分组列表
          this.loadBookGroup(refresh);
          this.initing = false;
          return;
        }
      }
      this.loadBookshelf()
        .then(() => {
          this.initing = false;
          // 加载书源列表
          this.loadBookSource(refresh);
          // 加载分组列表
          this.loadBookGroup(refresh);
        })
        .catch(() => {
          this.initing = false;
        });
    },
    setIP() {
      this.$prompt("请输入接口地址 ( 如：localhost:8080/reader3 )", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
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
                window.localStorage &&
                  window.localStorage.setItem("api_prefix", inputUrl);
                this.$store.commit("setApi", inputUrl);
                // 加载书源列表
                this.loadBookSource();
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

      return Axios.get(api + "/getBookshelf?refresh=" + (refresh ? 1 : 0))
        .then(response => {
          this.$store.commit("setConnected", true);
          this.loading.close();
          if (response.data.isSuccess) {
            // this.$store.commit("increaseBookNum", response.data.data.length);
            // this.popIntroVisible = response.data.data.reduce((c, v) => {
            //   c[v.name] = false;
            //   return c;
            // }, {});
            this.$store.commit("setShelfBooks", response.data.data);
            this.loadBookGroup();
          }
        })
        .catch(error => {
          this.loading.close();
          this.$store.commit("setConnected", false);
          this.$message.error("后端连接失败 " + (error && error.toString()));
          throw error;
        });
    },
    refreshShelf() {
      return this.loadBookshelf(null, true);
    },
    loadBookGroup(refresh) {
      const cacheKey =
        this.api +
        "#bookGroup@" +
        (this.$store.state.isManagerMode
          ? this.userNS
          : (this.$store.state.userInfo || {}).username || "default");
      const handler = data => {
        data = data || [];
        this.$store.commit("setBookGroupList", data);
        window.localStorage &&
          window.localStorage.setItem(cacheKey, JSON.stringify(data));
      };
      if (!refresh) {
        // 从缓存中获取
        try {
          const localGroupList = JSON.parse(
            window.localStorage && window.localStorage.getItem(cacheKey)
          );
          if (Array.isArray(localGroupList)) {
            handler(localGroupList);
            return;
          }
        } catch (error) {
          //
        }
      }
      Axios.get(this.api + "/getBookGroups").then(
        res => {
          if (res.data.isSuccess) {
            handler(res.data.data);
          }
        },
        error => {
          this.$message.error(
            "加载分组列表失败 " + (error && error.toString())
          );
        }
      );
    },
    loadBookSource(refresh) {
      const cacheKey =
        this.api +
        "#bookSource@" +
        (this.$store.state.isManagerMode
          ? this.userNS
          : (this.$store.state.userInfo || {}).username || "default");
      const handler = data => {
        data = data || [];
        this.$store.commit("setBookSourceList", data);
        if (this.bookSourceList.length) {
          this.bookSourceUrl =
            this.bookSourceUrl || this.bookSourceList[0].bookSourceUrl;
        }
        window.localStorage &&
          window.localStorage.setItem(cacheKey, JSON.stringify(data));
      };

      if (!refresh) {
        // 从缓存中获取
        try {
          const localSourceList = JSON.parse(
            window.localStorage && window.localStorage.getItem(cacheKey)
          );
          if (Array.isArray(localSourceList)) {
            handler(localSourceList);
            return;
          }
        } catch (error) {
          //
        }
      }
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      Axios.get(this.api + "/getSources", {
        params: {
          simple: 1
        }
      }).then(
        res => {
          if (res.data.isSuccess) {
            handler(res.data.data);
          }
        },
        error => {
          this.$message.error(
            "加载书源列表失败 " + (error && error.toString())
          );
        }
      );
    },
    searchBook(page) {
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      if (page) {
        this.searchPage = page;
      }
      page = this.searchPage;
      if (!this.search) {
        this.$message.error("请输入关键词进行搜索");
        return;
      }
      Axios.get(this.api + "/searchBook", {
        timeout: 30000,
        params: {
          key: this.search,
          bookSourceUrl: this.bookSourceUrl,
          page: page
        }
      }).then(
        res => {
          this.loadingMore = false;
          if (res.data.isSuccess) {
            //
            this.isSearchResult = true;
            this.isExploreResult = false;
            if (page === 1) {
              this.searchResult = res.data.data;
            } else {
              var data = [].concat(this.searchResult);
              var length = data.length;
              res.data.data.forEach(v => {
                if (!this.searchResultMap[v.bookUrl]) {
                  data.push(v);
                }
              });
              this.searchResult = data;
              if (data.length === length) {
                this.$message.error("没有更多啦");
              }
            }
          }
        },
        error => {
          this.$message.error("搜索书籍失败 " + (error && error.toString()));
        }
      );
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
        coverUrl: book.coverUrl,
        author: book.author
      });
      this.$router.push({
        path: "/reader"
      });
    },
    saveBook(book, isImport) {
      if (!book || !book.bookUrl || !book.origin) {
        this.$message.error("书籍信息错误");
        return;
      }
      Axios.post(this.api + "/saveBook", book).then(
        res => {
          if (res.data.isSuccess) {
            //
            if (isImport) {
              this.showImportBookDialog = false;
            }
            this.$message.success(isImport ? "导入书籍成功" : "加入书架成功");
            this.loadBookshelf();
          }
        },
        error => {
          this.$message.error(
            (isImport ? "导入书籍失败" : "加入书架失败 ") +
              (error && error.toString())
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
      this.loadingMore = true;
      if (this.isExploreResult) {
        this.$refs.popExplore.loadMore();
      } else {
        this.searchBook(this.searchPage + 1);
      }
    },
    uploadBookSource() {
      this.$refs.fileRef.dispatchEvent(new MouseEvent("click"));
    },
    onBookSourceFileChange(event) {
      const rawFile = event.target.files && event.target.files[0];
      // console.log("rawFile", rawFile);
      const reader = new FileReader();
      reader.onload = e => {
        const data = e.target.result;
        try {
          this.importBookSource = JSON.parse(data);
          this.showImportDialog = true;
        } catch (error) {
          this.$message.error("书源文件错误");
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
                this.importBookSource = sourceList;
                this.showImportDialog = true;
              } else {
                this.$message.error("书源文件错误");
              }
            }
          },
          error => {
            this.$message.error(
              "读取书源文件内容失败 " + (error && error.toString())
            );
          }
        );
      };
      reader.readAsText(rawFile);
      this.$refs.fileRef.value = null;
    },
    handleCheckAllChange(val) {
      this.checkedSourceIndex = val
        ? this.importBookSource.map((v, i) => i)
        : [];
      this.isIndeterminate = false;
    },
    handleCheckedSourcesChange(value) {
      let checkedCount = value.length;
      this.checkAll = checkedCount === this.importBookSource.length;
      this.isIndeterminate =
        checkedCount > 0 && checkedCount < this.importBookSource.length;
    },
    saveBookSourceList() {
      if (!this.$store.state.connected) {
        this.$message.error("后端未连接");
        return;
      }
      if (!this.checkedSourceIndex.length) {
        this.$message.error("请选择需要导入的源");
        return;
      }
      const sourceList = this.checkedSourceIndex.map(
        v => this.importBookSource[v]
      );
      Axios.post(this.api + "/saveSources", sourceList).then(
        res => {
          if (res.data.isSuccess) {
            //
            this.$message.success("导入书源成功");
            this.loadBookSource(true);
            this.showImportDialog = false;
          }
        },
        error => {
          this.$message.error("导入书源失败 " + (error && error.toString()));
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
          if (!handler.leftCount) {
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
    toggleBookIntroPop(book) {
      this.showBookInfo = book;
      this.showBookInfoDialog = true;
      // setTimeout(() => {
      //   for (const i in this.popIntroVisible) {
      //     if (Object.hasOwnProperty.call(this.popIntroVisible, i)) {
      //       if (i !== book.name) {
      //         this.popIntroVisible[i] = false;
      //       }
      //     }
      //   }
      //   this.popIntroVisible[book.name] = !this.popIntroVisible[book.name];
      // }, 100);
    },
    async saveUserConfig() {
      if (!window.localStorage) {
        this.$message.error("当前终端不支持localStorage");
        return;
      }
      const res = await this.$confirm(
        "确认要备份当前终端的阅读配置、过滤规则吗?",
        "提示"
      ).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      const userConfig = {};
      ["config", "filterRules"].forEach(key => {
        const val = window.localStorage.getItem(key);
        if (val) {
          userConfig[key] = val;
        }
      });
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
        "确认要从备份文件中恢复当前终端的阅读配置、过滤规则吗?",
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
                window.localStorage &&
                  window.localStorage.setItem(key, res.data.data[key]);
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
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
            this.$store.commit("setIsManagerMode", true);
            this.init(true);
          }
        },
        error => {
          this.$message.error(
            "加载用户空间失败 " + (error && error.toString())
          );
        }
      );
    },
    isUserSelectable(user) {
      return user.userNS !== "default";
    },
    async deleteUserList() {
      if (!this.manageUserSelection.length) {
        this.$message.error("请选择需要删除的用户");
        return;
      }
      const res = await this.$confirm("确认要删除所选择的用户吗?", "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(
        this.api + "/deleteUsers",
        this.manageUserSelection.map(v => v.username)
      ).then(
        res => {
          if (res.data.isSuccess) {
            this.manageUserSelection = [];
            this.$message.success("删除用户成功");
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
          }
        },
        error => {
          this.$message.error("删除用户失败 " + (error && error.toString()));
        }
      );
    },
    toggleUserWebdav(user, enableWebdav) {
      Axios.post(this.api + "/updateUser", {
        username: user.username,
        enableWebdav
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("修改成功");
            this.userList = res.data.data.map(v => ({
              ...v,
              userNS: v.username
            }));
          }
        },
        error => {
          this.$message.error("修改失败 " + (error && error.toString()));
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
        `确认要从该压缩文件恢复书源和书架信息吗?`,
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
        `确认要用当前书源和书架信息覆盖备份文件中的书源和书架信息吗?`,
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
      if (e.touches && e.touches[0]) {
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
    onBookFileChange() {
      const rawFile = event.target.files && event.target.files[0];
      if (!rawFile) {
        return;
      }
      let param = new FormData();
      param.append("file", rawFile);
      Axios.post(this.api + "/importBookPreview", param, {
        headers: { "Content-Type": "multipart/form-data" }
      }).then(
        res => {
          if (res.data.isSuccess && res.data.data.length) {
            //
            this.importBookInfo = res.data.data[0].book;
            this.importBookChapters = res.data.data[0].chapters;
            this.showImportBookDialog = true;
          }
        },
        error => {
          this.$message.error("上传书籍 " + (error && error.toString()));
        }
      );
    },
    importBookDialogClosed() {
      const url = this.importBookInfo.bookUrl;
      this.importBookInfo = {};
      this.importBookChapters = [];

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
      this.showBookGroupManageDialog = true;
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
    toggleBookGroupShow(bookGroup, show) {
      Axios.post(this.api + "/saveBookGroup", {
        ...bookGroup,
        show
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("修改成功");
            this.loadBookGroup(true);
          }
        },
        error => {
          this.$message.error("修改失败 " + (error && error.toString()));
        }
      );
    },
    async deleteBookGroup(row) {
      const res = await this.$confirm(`确认要删除该分组吗?`, "提示", {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning"
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/deleteBookGroup", {
        groupId: row.groupId
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("删除分组成功");
            this.loadBookGroup(true);
          }
        },
        error => {
          this.$message.error("删除分组失败 " + (error && error.toString()));
        }
      );
    },
    async saveBookGroup(bookGroup) {
      const res = await this.$prompt(`${bookGroup ? "编辑分组" : "添加分组"}`, {
        inputValue: bookGroup ? bookGroup.groupName : "",
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        inputValidator(v) {
          if (!v) {
            return "分组名不能为空";
          }
          return true;
        }
      }).catch(() => {
        return false;
      });
      if (!res) {
        return;
      }
      Axios.post(this.api + "/saveBookGroup", {
        ...bookGroup,
        groupName: res.value
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success(bookGroup ? "修改成功" : "添加成功");
            this.loadBookGroup(true);
          }
        },
        error => {
          this.$message.error(
            (bookGroup ? "修改失败" : "添加失败") + (error && error.toString())
          );
        }
      );
    },
    displayBookGroupName(bookGroup) {
      return (
        bookGroup.groupName +
        (bookGroup.groupId < 0
          ? "(" +
            this.$store.getters.builtInBookGroupMap[bookGroup.groupId] +
            ")"
          : "")
      );
    },
    displayOriginName(value) {
      if (value === "loc_book") return "本地";
      return (
        (this.bookSourceList.find(v => v.bookSourceUrl === value) || {})
          .bookSourceName || "未知书源"
      );
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
    getBookGroupListForBook(bookGroup) {
      const groups = [];
      this.$store.state.bookGroupList.forEach(v => {
        if (v.groupId > 0 && (v.groupId & bookGroup) !== 0) {
          groups.push(v);
        }
      });
      return groups;
    },
    showSetBookGroup() {
      this.isShowBookGroupSettingDialog = true;
      this.showBookGroupManageDialog = true;
      this.$nextTick(() => {
        this.$refs.bookGroupTableRef.clearSelection();
        this.getBookGroupListForBook(this.showBookInfo.group).forEach(v => {
          this.$refs.bookGroupTableRef.toggleRowSelection(v, true);
        });
      });
    },
    setBookGroup() {
      if (!this.bookGroupSelection.length) {
        this.$message.error("请选择书籍分组");
        return;
      }
      Axios.post(this.api + "/saveBookGroupId", {
        bookUrl: this.showBookInfo.bookUrl,
        groupId: this.bookGroupSelection.reduce((c, v) => {
          return c | v.groupId;
        }, 0)
      }).then(
        res => {
          if (res.data.isSuccess) {
            this.$message.success("设置成功");
            this.showBookGroupManageDialog = false;
            this.isShowBookGroupSettingDialog = false;
            this.showBookInfo = res.data.data;
            this.$store.commit("updateShelfBook", res.data.data);
          }
        },
        error => {
          this.$message.error("设置失败" + (error && error.toString()));
        }
      );
    }
  },
  computed: {
    config() {
      return this.$store.state.config;
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
        ? `已连接` + this.api
        : this.connecting
        ? "正在连接后端服务器……"
        : "点击设置后端接口前缀";
    },
    connectType() {
      return this.$store.state.connected ? "success" : "danger";
    },
    collapseMenu() {
      return this.$store.state.miniInterface;
    },
    dialogWidth() {
      return this.collapseMenu ? "85%" : "700px";
    },
    dialogSmallWidth() {
      return this.collapseMenu ? "85%" : "500px";
    },
    dialogTop() {
      return (
        (this.$store.state.windowSize.height -
          this.dialogContentHeight -
          70 -
          54 -
          60) /
          2 +
        "px"
      );
    },
    dialogContentHeight() {
      if (this.collapseMenu) {
        return this.$store.state.windowSize.height - 54 - 60 - 70;
      }
      return Math.min(
        0.9 * this.$store.state.windowSize.height - 70 - 54 - 60,
        400
      );
    },
    popupWidth() {
      return this.collapseMenu ? this.$store.state.windowSize.width : "600";
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
    showBookGroupList() {
      if (!this.isShowBookGroupSettingDialog) {
        return this.$store.state.bookGroupList;
      }
      return this.$store.state.bookGroupList.filter(v => v.groupId > 0);
    },
    bookCoverBgStyle() {
      return {
        backgroundImage: `url(${this.getCover(
          this.showBookInfo.coverUrl,
          true
        )})`
      };
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
            justify-content: space-around;
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
              margin-right: 30px;
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
  >>>.el-table {
    background-color: transparent;
  }

  >>.el-table__expanded-cell {
    background-color: transparent;
  }
  >>>.el-table th, >>>.el-table tr{
    background-color: #222 !important;
  }
  >>>.el-table td {
    border-bottom: 1px solid #555;
  }
  >>>.el-table th.is-leaf {
    border-bottom: 1px solid #555;
  }
  >>>.el-table--border::after {
    background-color: transparent;
  }
  >>>.el-table--group::after {
    background-color: transparent;
  }
  >>>.el-table::before {
    background-color: transparent;
  }
  >>>.el-table {
    background-color: transparent;
  }
  >>>.el-table--enable-row-hover .el-table__body tr:hover>td {
    background-color: #333;
  }
  >>>.el-table__fixed-right::before, >>>.el-table__fixed::before {
    background-color: #333;
  }
  >>>.el-table__body tr.hover-row.current-row>td,
  >>>.el-table__body tr.hover-row.el-table__row--striped.current-row>td,
  >>>.el-table__body tr.hover-row.el-table__row--striped>td,
  >>>.el-table__body tr.hover-row>td {
    background-color: #444;
  }
  >>>.check-tip {
    color: #bbb;
  }

  >>> .el-table__body-wrapper::-webkit-scrollbar {
    background-color: #333 !important;
  }

  >>> .el-dialog__wrapper::-webkit-scrollbar {
    background-color: #333 !important;
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
    justify-content: space-between;

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

  .chapter-title {
    font-size: 15px;
    padding: 5px 0;
    font-weight: 600;
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

.float-left {
  float: left;
}

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

      .book-prop-btn {
        float: right;
        height: 19px;
        padding: 0;
      }
    }
  }

  .book-intro {
    line-height: 1.6;
    max-height: calc(var(--vh, 1vh) * 70 - 54px - 60px - 150px - 75px - 120px);
    overflow-y: auto;
  }
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

  .book-info-container {
    .book-name {
      color: #eee;
    }
  }
}

.check-tip {
  display: inline-block;
  float: left;
  line-height: 40px;
  margin-left: 10px;
  font-size: 14px;
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
  .book-info-container {
    .book-intro {
      max-height: calc(var(--vh, 1vh) * 100 - 54px - 60px - 150px - 75px - 120px);
    }
  }
}
@media screen and (max-width: 450px) {
  .source-container.table-container {
    margin: -15px -5px;
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

@media (hover: hover) {
  .book:hover {
    background: rgba(0, 0, 0, 0.1);
    transition-duration: 0.5s;
  }
}
</style>
