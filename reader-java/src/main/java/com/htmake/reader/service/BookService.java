package com.htmake.reader.service;

import com.google.gson.Gson;
import com.htmake.reader.config.ReaderConfig;
import com.htmake.reader.entity.Book;
import com.htmake.reader.entity.BookChapter;
import com.htmake.reader.entity.BookSource;
import com.htmake.reader.entity.SearchBook;
import com.htmake.reader.utils.MD5Utils;
import com.htmake.reader.utils.StorageHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 书籍服务
 */
@Slf4j
@Service
public class BookService {

    private static final Gson GSON = new Gson();

    // 书籍信息缓存，用于存储搜索/浏览过的书籍信息（包含书源）
    private final Map<String, Book> bookInfoCache = new ConcurrentHashMap<>();

    @Autowired
    private StorageHelper storageHelper;

    @Autowired
    private ReaderConfig readerConfig;

    @Autowired
    private BookSourceService bookSourceService;

    @Autowired
    private WebBookService webBookService;

    /**
     * 缓存书籍信息
     */
    public void cacheBookInfo(Book book) {
        if (book != null && book.getBookUrl() != null && !book.getBookUrl().isEmpty()) {
            bookInfoCache.put(book.getBookUrl(), book);
            log.debug("缓存书籍信息: {}", book.getBookUrl());
        }
    }

    /**
     * 批量缓存书籍信息
     */
    public void cacheBookInfoList(List<Book> bookList) {
        if (bookList != null) {
            for (Book book : bookList) {
                cacheBookInfo(book);
            }
        }
    }

    /**
     * 从缓存获取书籍信息
     */
    public Book getCachedBookInfo(String bookUrl) {
        if (bookUrl == null || bookUrl.isEmpty()) {
            return null;
        }
        return bookInfoCache.get(bookUrl);
    }

    /**
     * 获取书架列表
     */
    public List<Book> getShelfBookList(String username) {
        List<Book> bookList = new ArrayList<>();
        String shelfPath = getShelfPath(username);
        File shelfDir = new File(shelfPath);

        if (!shelfDir.exists()) {
            return bookList;
        }

        File[] bookDirs = shelfDir.listFiles(File::isDirectory);
        if (bookDirs != null) {
            for (File bookDir : bookDirs) {
                File bookFile = new File(bookDir, "book.json");
                if (bookFile.exists()) {
                    String json = storageHelper.readFile(bookFile.getAbsolutePath());
                    if (json != null) {
                        try {
                            Book book = GSON.fromJson(json, Book.class);
                            bookList.add(book);
                        } catch (Exception e) {
                            log.error("解析书籍信息失败: {}", bookFile.getAbsolutePath(), e);
                        }
                    }
                }
            }
        }

        return bookList;
    }

    /**
     * 根据URL获取书架上的书籍
     */
    public Book getShelfBookByURL(String bookUrl, String username) {
        if (bookUrl == null || bookUrl.isEmpty()) {
            return null;
        }

        String bookDir = getBookDir(bookUrl, username);
        File bookFile = new File(bookDir, "book.json");

        if (!bookFile.exists()) {
            return null;
        }

        String json = storageHelper.readFile(bookFile.getAbsolutePath());
        if (json == null) {
            return null;
        }

        try {
            return GSON.fromJson(json, Book.class);
        } catch (Exception e) {
            log.error("解析书籍信息失败: {}", bookFile.getAbsolutePath(), e);
            return null;
        }
    }

    /**
     * 保存书籍到书架
     */
    public boolean saveBook(Book book, String username) {
        if (book == null || book.getBookUrl() == null || book.getBookUrl().isEmpty()) {
            return false;
        }

        String bookDir = getBookDir(book.getBookUrl(), username);
        File dir = new File(bookDir);
        if (!dir.exists()) {
            dir.mkdirs();
        }

        File bookFile = new File(dir, "book.json");
        String json = GSON.toJson(book);

        return storageHelper.writeFile(bookFile.getAbsolutePath(), json);
    }

    /**
     * 从书架删除书籍
     */
    public boolean deleteBook(String bookUrl, String username) {
        if (bookUrl == null || bookUrl.isEmpty()) {
            return false;
        }

        String bookDir = getBookDir(bookUrl, username);
        File dir = new File(bookDir);

        if (dir.exists()) {
            return deleteDirectory(dir);
        }

        return true;
    }

    /**
     * 保存章节列表
     */
    public boolean saveChapterList(String bookUrl, List<BookChapter> chapterList, String username) {
        if (bookUrl == null || bookUrl.isEmpty() || chapterList == null) {
            return false;
        }

        String bookDir = getBookDir(bookUrl, username);
        File dir = new File(bookDir);
        if (!dir.exists()) {
            dir.mkdirs();
        }

        File chapterFile = new File(dir, "chapters.json");
        String json = GSON.toJson(chapterList);

        return storageHelper.writeFile(chapterFile.getAbsolutePath(), json);
    }

    /**
     * 获取章节列表
     */
    public List<BookChapter> getChapterList(String bookUrl, String username) {
        if (bookUrl == null || bookUrl.isEmpty()) {
            return new ArrayList<>();
        }

        String bookDir = getBookDir(bookUrl, username);
        File chapterFile = new File(bookDir, "chapters.json");

        if (!chapterFile.exists()) {
            return new ArrayList<>();
        }

        String json = storageHelper.readFile(chapterFile.getAbsolutePath());
        if (json == null) {
            return new ArrayList<>();
        }

        try {
            BookChapter[] chapters = GSON.fromJson(json, BookChapter[].class);
            List<BookChapter> chapterList = new ArrayList<>();
            if (chapters != null) {
                for (BookChapter chapter : chapters) {
                    chapterList.add(chapter);
                }
            }
            return chapterList;
        } catch (Exception e) {
            log.error("解析章节列表失败: {}", chapterFile.getAbsolutePath(), e);
            return new ArrayList<>();
        }
    }

    /**
     * 保存阅读进度
     */
    public boolean saveProgress(String bookUrl, int chapterIndex, String username) {
        Book book = getShelfBookByURL(bookUrl, username);
        if (book == null) {
            return false;
        }

        book.setDurChapterIndex(chapterIndex);
        book.setDurChapterTime(System.currentTimeMillis());
        book.setLatestChapterTime(System.currentTimeMillis());

        return saveBook(book, username);
    }

    /**
     * 搜索书籍
     * TODO: 实现完整的书源搜索逻辑
     */
    public List<Book> searchBooks(String keyword, String sourceUrl, int page, String username) {
        List<Book> results = new ArrayList<>();

        // 目前返回本地书架中匹配关键词的书籍
        // 后续需要实现通过书源在线搜索
        List<Book> shelfBooks = getShelfBookList(username);

        for (Book book : shelfBooks) {
            if (matchesKeyword(book, keyword)) {
                results.add(book);
            }
        }

        log.info("搜索书籍: keyword={}, sourceUrl={}, 结果数={}", keyword, sourceUrl, results.size());
        return results;
    }

    /**
     * 发现书籍 (探索)
     */
    public List<Book> exploreBooks(String url, int page, String bookSourceUrl, String username) {
        try {
            BookSource source = bookSourceService.getBookSourceByUrl(bookSourceUrl, username);
            if (source == null) {
                log.warn("发现书籍失败: 找不到书源 {}", bookSourceUrl);
                return new ArrayList<>();
            }

            var searchBooks = webBookService.exploreBook(source, url, page);
            List<Book> results = new ArrayList<>();
            for (var sb : searchBooks) {
                results.add(sb.toBook());
            }
            return results;
        } catch (Exception e) {
            log.error("发现书籍失败: url={}, sourceUrl={}", url, bookSourceUrl, e);
            return new ArrayList<>();
        }
    }

    /**
     * 获取书籍信息
     */
    public Book getBookInfo(String bookUrl, String sourceUrl, String username) {
        // 先从本地书架查找
        Book book = getShelfBookByURL(bookUrl, username);
        if (book != null) {
            return book;
        }

        // TODO: 如果本地没有，通过书源获取
        log.info("获取书籍信息: bookUrl={}, sourceUrl={}", bookUrl, sourceUrl);
        return null;
    }

    /**
     * 获取章节内容
     */
    public String getChapterContent(String bookUrl, int chapterIndex, String username) {
        return getChapterContent(bookUrl, chapterIndex, username, false);
    }

    public String getChapterContent(String bookUrl, int chapterIndex, String username, boolean refresh) {
        if (bookUrl == null || bookUrl.isEmpty()) {
            return "";
        }

        if (!refresh) {
            String cached = getCachedContent(bookUrl, chapterIndex, username);
            if (cached != null && !cached.isEmpty()) {
                return cached;
            }
        }

        Book book = getShelfBookByURL(bookUrl, username);
        if (book == null) {
            return "";
        }
        if (book.isLocalBook() || "loc_book".equals(book.getOrigin())) {
            return "";
        }

        BookSource bookSource = bookSourceService.getBookSourceByUrl(book.getOrigin(), username);
        if (bookSource == null) {
            return "";
        }

        List<BookChapter> chapterList = getChapterList(bookUrl, username);
        if (chapterList == null || chapterList.isEmpty()) {
            try {
                chapterList = webBookService.getChapterList(bookSource, book);
            } catch (Exception e) {
                log.warn("获取章节列表失败: bookUrl={}", bookUrl, e);
                return "";
            }
            if (chapterList != null) {
                for (BookChapter ch : chapterList) {
                    if (ch != null) {
                        ch.setBookUrl(bookUrl);
                    }
                }
            }
            if (chapterList != null && !chapterList.isEmpty()) {
                saveChapterList(bookUrl, chapterList, username);
            }
        }

        if (chapterList == null || chapterList.isEmpty()) {
            return "";
        }

        if (chapterIndex < 0 || chapterIndex >= chapterList.size()) {
            return "";
        }

        BookChapter chapter = chapterList.get(chapterIndex);
        if (chapter == null || chapter.getUrl() == null || chapter.getUrl().isEmpty()) {
            return "";
        }

        try {
            String content = webBookService.getChapterContent(bookSource, chapter);
            if (content == null || content.isEmpty()) {
                return "";
            }
            saveChapterContent(bookUrl, chapterIndex, content, username);
            return content;
        } catch (Exception e) {
            log.warn("获取章节内容失败: bookUrl={}, chapterIndex={}", bookUrl, chapterIndex, e);
            return "";
        }
    }

    /**
     * 刷新章节列表
     */
    public List<BookChapter> refreshChapterList(String bookUrl, String username) {
        // TODO: 通过书源刷新章节列表
        log.info("刷新章节列表: bookUrl={}", bookUrl);

        // 暂时返回本地缓存的章节列表
        return getChapterList(bookUrl, username);
    }

    /**
     * 判断书籍是否匹配关键词
     */
    private boolean matchesKeyword(Book book, String keyword) {
        if (keyword == null || keyword.isEmpty()) {
            return true;
        }
        String lowerKeyword = keyword.toLowerCase();

        if (book.getName() != null && book.getName().toLowerCase().contains(lowerKeyword)) {
            return true;
        }
        if (book.getAuthor() != null && book.getAuthor().toLowerCase().contains(lowerKeyword)) {
            return true;
        }
        return false;
    }

    /**
     * 获取缓存的章节内容
     */
    public String getCachedContent(String bookUrl, int chapterIndex, String username) {
        String bookDir = getBookDir(bookUrl, username);
        File contentFile = new File(bookDir, "content_" + chapterIndex + ".txt");

        if (contentFile.exists()) {
            return storageHelper.readFile(contentFile.getAbsolutePath());
        }
        return null;
    }

    /**
     * 保存章节内容到缓存
     */
    public boolean saveChapterContent(String bookUrl, int chapterIndex, String content, String username) {
        String bookDir = getBookDir(bookUrl, username);
        File dir = new File(bookDir);
        if (!dir.exists()) {
            dir.mkdirs();
        }

        File contentFile = new File(dir, "content_" + chapterIndex + ".txt");
        return storageHelper.writeFile(contentFile.getAbsolutePath(), content);
    }

    public int getCachedChapterCount(String bookUrl, String username) {
        if (bookUrl == null || bookUrl.isEmpty()) {
            return 0;
        }
        String bookDir = getBookDir(bookUrl, username);
        File dir = new File(bookDir);
        if (!dir.exists() || !dir.isDirectory()) {
            return 0;
        }
        File[] cached = dir.listFiles(f -> f != null && f.isFile() && f.getName().startsWith("content_") && f.getName().endsWith(".txt"));
        return cached == null ? 0 : cached.length;
    }

    /**
     * 获取书架路径
     */
    private String getShelfPath(String username) {
        return storageHelper.getUserDataPath(username) + File.separator + "shelf";
    }

    /**
     * 获取书籍目录
     */
    private String getBookDir(String bookUrl, String username) {
        String md5 = MD5Utils.md5Encode16(bookUrl);
        return getShelfPath(username) + File.separator + md5;
    }

    /**
     * 递归删除目录
     */
    private boolean deleteDirectory(File directory) {
        if (directory.isDirectory()) {
            File[] files = directory.listFiles();
            if (files != null) {
                for (File file : files) {
                    deleteDirectory(file);
                }
            }
        }
        return directory.delete();
    }
}
