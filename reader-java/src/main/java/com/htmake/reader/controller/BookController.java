package com.htmake.reader.controller;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.htmake.reader.config.ReaderConfig;
import com.htmake.reader.entity.Book;
import com.htmake.reader.entity.BookChapter;
import com.htmake.reader.entity.BookSource;
import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.entity.SearchBook;
import com.htmake.reader.entity.User;
import com.htmake.reader.service.BookService;
import com.htmake.reader.service.BookSourceService;
import com.htmake.reader.service.UserService;
import com.htmake.reader.service.WebBookService;
import com.htmake.reader.utils.MD5Utils;
import com.htmake.reader.utils.StorageHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.io.InputStream;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 书籍管理Controller
 */
@Slf4j
@RestController
@RequestMapping("/reader3")
public class BookController {

    private static final Gson GSON = new Gson();
    private static volatile List<Map<String, Object>> DEFAULT_TXT_TOC_RULES;

    @Autowired
    private BookService bookService;

    @Autowired
    private ReaderConfig readerConfig;

    @Autowired
    private StorageHelper storageHelper;

    @Autowired
    private BookSourceService bookSourceService;

    @Autowired
    private WebBookService webBookService;

    @Autowired
    private UserService userService;

    @RequestMapping(value = "/getTxtTocRules", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getTxtTocRules(@RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS,
            @RequestBody(required = false) Map<String, Object> body) {
        try {
            String finalAccessToken = accessToken;
            if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null && body.get("accessToken") != null) {
                finalAccessToken = String.valueOf(body.get("accessToken"));
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())
                    && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null && !finalAccessToken.isEmpty()) {
                String[] parts = finalAccessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
            }

            return ReturnData.success(getDefaultTxtTocRules());
        } catch (Exception e) {
            log.error("获取TXT目录规则失败", e);
            return ReturnData.error("获取TXT目录规则失败: " + e.getMessage());
        }
    }

    private List<Map<String, Object>> getDefaultTxtTocRules() {
        List<Map<String, Object>> cached = DEFAULT_TXT_TOC_RULES;
        if (cached != null) {
            return cached;
        }
        synchronized (BookController.class) {
            if (DEFAULT_TXT_TOC_RULES != null) {
                return DEFAULT_TXT_TOC_RULES;
            }
            try (InputStream is = BookController.class.getClassLoader().getResourceAsStream("defaultData/txtTocRule.json")) {
                if (is == null) {
                    DEFAULT_TXT_TOC_RULES = new ArrayList<>();
                    return DEFAULT_TXT_TOC_RULES;
                }
                String json = new String(is.readAllBytes(), StandardCharsets.UTF_8);
                Type type = new TypeToken<List<Map<String, Object>>>() {
                }.getType();
                List<Map<String, Object>> list = GSON.fromJson(json, type);
                DEFAULT_TXT_TOC_RULES = list == null ? new ArrayList<>() : list;
                return DEFAULT_TXT_TOC_RULES;
            } catch (Exception e) {
                DEFAULT_TXT_TOC_RULES = new ArrayList<>();
                return DEFAULT_TXT_TOC_RULES;
            }
        }
    }

    /**
     * 获取书架列表
     */
    @GetMapping("/getShelfBooks")
    public ReturnData getShelfBooks(@RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            List<Book> bookList = bookService.getShelfBookList(username);
            return ReturnData.success(bookList);
        } catch (Exception e) {
            log.error("获取书架列表失败", e);
            return ReturnData.error("获取书架列表失败: " + e.getMessage());
        }
    }

    /**
     * 获取书架列表（兼容原项目接口名：getBookshelf）
     * <p>
     * 前端可能以 GET query 或 POST body 传 refresh 参数；当前实现不依赖 refresh，仅为兼容保留。
     */
    @RequestMapping(value = "/getBookshelf", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getBookshelf(@RequestParam(value = "refresh", required = false) Integer refresh,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            // refresh 参数仅用于兼容（不论是否传入，都返回当前书架列表）
            List<Book> bookList = bookService.getShelfBookList(username);
            return ReturnData.success(bookList);
        } catch (Exception e) {
            log.error("获取书架列表失败", e);
            return ReturnData.error("获取书架列表失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getAvailableBookSource", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getAvailableBookSource(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "refresh", required = false) Integer refresh,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            String finalAccessToken = accessToken;
            if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null && body.get("accessToken") != null) {
                finalAccessToken = String.valueOf(body.get("accessToken"));
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())
                    && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null
                    && !finalAccessToken.isEmpty()) {
                String[] parts = finalAccessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = url;
            if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body != null) {
                Object v = body.get("url");
                if (v != null) {
                    finalBookUrl = String.valueOf(v);
                } else if (body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                }
            }
            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("请输入书籍链接");
            }

            int finalRefresh = refresh != null ? refresh : 0;
            if (body != null && body.get("refresh") != null) {
                Object v = body.get("refresh");
                if (v instanceof Number) {
                    finalRefresh = ((Number) v).intValue();
                } else {
                    try {
                        finalRefresh = Integer.parseInt(String.valueOf(v));
                    } catch (Exception ignore) {
                        finalRefresh = 0;
                    }
                }
            }

            Book book = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            if (book == null) {
                return ReturnData.error("书籍信息错误");
            }

            String bookName = book.getName() == null ? "" : book.getName();
            String bookAuthor = book.getAuthor() == null ? "" : book.getAuthor();
            String bookSourcePath = storageHelper.getUserDataPath(finalUser) + File.separator + bookName + "_"
                    + bookAuthor + File.separator + "bookSource.json";
            File bookSourceFile = new File(bookSourcePath);

            List<SearchBook> localSources = new ArrayList<>();
            if (bookSourceFile.exists()) {
                String json = storageHelper.readFile(bookSourcePath);
                if (json != null && !json.isEmpty()) {
                    try {
                        Type listType = new TypeToken<List<SearchBook>>() {
                        }.getType();
                        List<SearchBook> parsed = GSON.fromJson(json, listType);
                        if (parsed != null) {
                            localSources = parsed;
                        }
                    } catch (Exception e) {
                        log.warn("解析书源缓存失败: {}", bookSourcePath, e);
                    }
                }
            }

            if (localSources.isEmpty()) {
                return ReturnData.success(new ArrayList<>());
            }
            if (finalRefresh <= 0) {
                return ReturnData.success(localSources);
            }

            Map<String, BookSource> sourceMap = new HashMap<>();
            for (BookSource source : bookSourceService.getAllBookSources(finalUser)) {
                if (source != null && source.getBookSourceUrl() != null && !source.getBookSourceUrl().isEmpty()) {
                    sourceMap.put(source.getBookSourceUrl(), source);
                }
            }

            List<SearchBook> resultList = new ArrayList<>();
            for (SearchBook searchBook : localSources) {
                if (searchBook == null) {
                    continue;
                }
                String origin = searchBook.getOrigin();
                if ("loc_book".equals(origin)) {
                    resultList.add(searchBook);
                    continue;
                }
                BookSource source = sourceMap.get(origin);
                if (source == null) {
                    continue;
                }
                try {
                    long start = System.currentTimeMillis();
                    List<SearchBook> books = webBookService.searchBook(source, bookName, 1);
                    long end = System.currentTimeMillis();
                    if (books == null) {
                        continue;
                    }
                    for (SearchBook item : books) {
                        if (item == null) {
                            continue;
                        }
                        String name = item.getName() == null ? "" : item.getName();
                        String author = item.getAuthor() == null ? "" : item.getAuthor();
                        if (name.equals(bookName) && author.equals(bookAuthor)) {
                            item.setTime(end - start);
                            resultList.add(item);
                        }
                    }
                } catch (Exception e) {
                    log.warn("刷新书源失败: {}", source.getBookSourceName(), e);
                }
            }

            storageHelper.writeFile(bookSourcePath, GSON.toJson(resultList));
            return ReturnData.success(resultList);
        } catch (Exception e) {
            log.error("获取可用书源失败", e);
            return ReturnData.error("获取可用书源失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getBookGroups", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getBookGroups(@RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            List<Map<String, Object>> defaultGroups = new ArrayList<>();
            defaultGroups.add(new HashMap<>(Map.of("groupId", -1, "groupName", "全部", "order", -10, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -2, "groupName", "本地", "order", -9, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -3, "groupName", "音频", "order", -8, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -4, "groupName", "未分组", "order", -7, "show", true)));

            String groupPath = storageHelper.getUserDataPath(finalUser) + File.separator + "bookGroup.json";
            File groupFile = new File(groupPath);
            if (!groupFile.exists()) {
                storageHelper.writeFile(groupPath, GSON.toJson(defaultGroups));
                return ReturnData.success(defaultGroups);
            }

            String json = storageHelper.readFile(groupPath);
            if (json == null || json.isEmpty()) {
                storageHelper.writeFile(groupPath, GSON.toJson(defaultGroups));
                return ReturnData.success(defaultGroups);
            }

            Type listType = new TypeToken<List<Map<String, Object>>>() {
            }.getType();
            List<Map<String, Object>> groups = GSON.fromJson(json, listType);
            if (groups == null) {
                groups = defaultGroups;
            }
            return ReturnData.success(groups);
        } catch (Exception e) {
            log.error("获取分组列表失败", e);
            return ReturnData.error("获取分组列表失败: " + e.getMessage());
        }
    }

    @PostMapping("/saveBookGroup")
    public ReturnData saveBookGroup(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (body == null) {
                return ReturnData.error("参数错误");
            }

            String groupName = body.get("groupName") == null ? "" : String.valueOf(body.get("groupName"));
            if (groupName == null || groupName.trim().isEmpty()) {
                return ReturnData.error("分组名称不能为空");
            }

            int groupId = 0;
            Object groupIdObj = body.get("groupId");
            if (groupIdObj instanceof Number) {
                groupId = ((Number) groupIdObj).intValue();
            }

            Integer inputOrder = null;
            Object orderObj = body.get("order");
            if (orderObj instanceof Number) {
                inputOrder = ((Number) orderObj).intValue();
            }

            Boolean show = null;
            Object showObj = body.get("show");
            if (showObj instanceof Boolean) {
                show = (Boolean) showObj;
            } else if (showObj instanceof Number) {
                show = ((Number) showObj).intValue() != 0;
            } else if (showObj != null) {
                String s = String.valueOf(showObj);
                if ("true".equalsIgnoreCase(s) || "false".equalsIgnoreCase(s)) {
                    show = Boolean.parseBoolean(s);
                }
            }
            if (show == null) {
                show = true;
            }

            List<Map<String, Object>> defaultGroups = new ArrayList<>();
            defaultGroups.add(new HashMap<>(Map.of("groupId", -1, "groupName", "全部", "order", -10, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -2, "groupName", "本地", "order", -9, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -3, "groupName", "音频", "order", -8, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -4, "groupName", "未分组", "order", -7, "show", true)));

            String groupPath = storageHelper.getUserDataPath(finalUser) + File.separator + "bookGroup.json";
            String json = storageHelper.readFile(groupPath);
            Type listType = new TypeToken<List<Map<String, Object>>>() {
            }.getType();
            List<Map<String, Object>> groups = null;
            if (json != null && !json.isEmpty()) {
                groups = GSON.fromJson(json, listType);
            }
            if (groups == null || groups.isEmpty()) {
                groups = new ArrayList<>(defaultGroups);
            } else {
                Map<Integer, Map<String, Object>> byId = new HashMap<>();
                for (Map<String, Object> g : groups) {
                    if (g == null) {
                        continue;
                    }
                    Object gidObj = g.get("groupId");
                    if (gidObj instanceof Number) {
                        byId.put(((Number) gidObj).intValue(), g);
                    }
                }
                for (Map<String, Object> dg : defaultGroups) {
                    Object gidObj = dg.get("groupId");
                    if (gidObj instanceof Number) {
                        int gid = ((Number) gidObj).intValue();
                        if (!byId.containsKey(gid)) {
                            groups.add(new HashMap<>(dg));
                        }
                    }
                }
            }

            int existIndex = -1;
            for (int i = 0; i < groups.size(); i++) {
                Map<String, Object> g = groups.get(i);
                if (g == null) {
                    continue;
                }
                Object gidObj = g.get("groupId");
                if (gidObj instanceof Number && ((Number) gidObj).intValue() == groupId) {
                    existIndex = i;
                    break;
                }
            }

            Map<String, Object> bookGroup = new HashMap<>();
            bookGroup.put("groupId", groupId);
            bookGroup.put("groupName", groupName);
            bookGroup.put("show", show);

            if (inputOrder != null) {
                bookGroup.put("order", inputOrder);
            } else if (existIndex >= 0) {
                Object oldOrder = groups.get(existIndex).get("order");
                if (oldOrder instanceof Number) {
                    bookGroup.put("order", ((Number) oldOrder).intValue());
                } else if (oldOrder != null) {
                    bookGroup.put("order", oldOrder);
                }
            }

            if (existIndex >= 0) {
                groups.set(existIndex, bookGroup);
            } else {
                if (groupId >= 0) {
                    int usedMask = 0;
                    int maxOrder = 0;
                    for (Map<String, Object> g : groups) {
                        if (g == null) {
                            continue;
                        }
                        Object gidObj = g.get("groupId");
                        if (gidObj instanceof Number) {
                            int gid = ((Number) gidObj).intValue();
                            if (gid > 0) {
                                usedMask |= gid;
                            }
                        }
                        Object oObj = g.get("order");
                        if (oObj instanceof Number) {
                            int o = ((Number) oObj).intValue();
                            if (o > maxOrder) {
                                maxOrder = o;
                            }
                        }
                    }
                    int newId = 1;
                    while ((newId & usedMask) != 0) {
                        newId <<= 1;
                    }
                    bookGroup.put("groupId", newId);
                    if (!bookGroup.containsKey("order")) {
                        bookGroup.put("order", maxOrder + 1);
                    }
                } else if (!bookGroup.containsKey("order")) {
                    bookGroup.put("order", 0);
                }
                groups.add(bookGroup);
            }

            boolean ok = storageHelper.writeFile(groupPath, GSON.toJson(groups));
            if (!ok) {
                return ReturnData.error("保存失败");
            }
            return ReturnData.success("");
        } catch (Exception e) {
            log.error("保存分组失败", e);
            return ReturnData.error("保存分组失败: " + e.getMessage());
        }
    }

    @PostMapping("/deleteBookGroup")
    public ReturnData deleteBookGroup(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (body == null) {
                return ReturnData.error("参数错误");
            }

            Object groupIdObj = body.get("groupId");
            if (!(groupIdObj instanceof Number)) {
                return ReturnData.error("参数错误");
            }
            int groupId = ((Number) groupIdObj).intValue();
            if (groupId <= 0) {
                return ReturnData.error("不能删除内置分组");
            }

            String groupPath = storageHelper.getUserDataPath(finalUser) + File.separator + "bookGroup.json";
            String json = storageHelper.readFile(groupPath);
            Type listType = new TypeToken<List<Map<String, Object>>>() {
            }.getType();
            List<Map<String, Object>> groups = null;
            if (json != null && !json.isEmpty()) {
                groups = GSON.fromJson(json, listType);
            }
            if (groups == null) {
                groups = new ArrayList<>();
            }

            int existIndex = -1;
            for (int i = 0; i < groups.size(); i++) {
                Map<String, Object> g = groups.get(i);
                if (g == null) {
                    continue;
                }
                Object gidObj = g.get("groupId");
                if (gidObj instanceof Number && ((Number) gidObj).intValue() == groupId) {
                    existIndex = i;
                    break;
                }
            }
            if (existIndex >= 0) {
                groups.remove(existIndex);
            }

            boolean ok = storageHelper.writeFile(groupPath, GSON.toJson(groups));
            if (!ok) {
                return ReturnData.error("保存失败");
            }
            return ReturnData.success("");
        } catch (Exception e) {
            log.error("删除分组失败", e);
            return ReturnData.error("删除分组失败: " + e.getMessage());
        }
    }

    @PostMapping("/addBookGroupMulti")
    public ReturnData addBookGroupMulti(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (body == null) {
                return ReturnData.error("分组信息错误");
            }

            Object groupIdObj = body.get("groupId");
            if (!(groupIdObj instanceof Number)) {
                return ReturnData.error("分组信息错误");
            }
            int groupId = ((Number) groupIdObj).intValue();
            if (groupId <= 0) {
                return ReturnData.error("分组信息错误");
            }

            Object listObj = body.get("bookList");
            if (!(listObj instanceof List<?>)) {
                return ReturnData.success("");
            }

            List<?> bookList = (List<?>) listObj;
            if (bookList.isEmpty()) {
                return ReturnData.success("");
            }

            List<Book> shelfBooks = null;
            for (Object item : bookList) {
                if (item == null) {
                    continue;
                }
                Book incoming;
                try {
                    incoming = GSON.fromJson(GSON.toJson(item), Book.class);
                } catch (Exception e) {
                    continue;
                }
                if (incoming == null) {
                    continue;
                }
                String bookUrl = incoming.getBookUrl();
                if ((bookUrl == null || bookUrl.isEmpty()) && incoming.getName() != null
                        && incoming.getAuthor() != null) {
                    if (shelfBooks == null) {
                        shelfBooks = bookService.getShelfBookList(finalUser);
                    }
                    for (Book shelfBook : shelfBooks) {
                        if (shelfBook == null) {
                            continue;
                        }
                        if (incoming.getName().equals(shelfBook.getName())
                                && incoming.getAuthor().equals(shelfBook.getAuthor())) {
                            bookUrl = shelfBook.getBookUrl();
                            break;
                        }
                    }
                }
                if (bookUrl == null || bookUrl.isEmpty()) {
                    continue;
                }

                Book shelfBook = bookService.getShelfBookByURL(bookUrl, finalUser);
                if (shelfBook == null) {
                    continue;
                }
                Integer currentGroup = shelfBook.getGroup();
                int nextGroup = (currentGroup == null ? 0 : currentGroup) | groupId;
                shelfBook.setGroup(nextGroup);
                bookService.saveBook(shelfBook, finalUser);
            }

            return ReturnData.success("");
        } catch (Exception e) {
            log.error("批量添加分组失败", e);
            return ReturnData.error("批量添加分组失败: " + e.getMessage());
        }
    }

    @PostMapping("/removeBookGroupMulti")
    public ReturnData removeBookGroupMulti(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (body == null) {
                return ReturnData.error("分组信息错误");
            }

            Object groupIdObj = body.get("groupId");
            if (!(groupIdObj instanceof Number)) {
                return ReturnData.error("分组信息错误");
            }
            int groupId = ((Number) groupIdObj).intValue();
            if (groupId <= 0) {
                return ReturnData.error("分组信息错误");
            }

            Object listObj = body.get("bookList");
            if (!(listObj instanceof List<?>)) {
                return ReturnData.success("");
            }

            List<?> bookList = (List<?>) listObj;
            if (bookList.isEmpty()) {
                return ReturnData.success("");
            }

            List<Book> shelfBooks = null;
            for (Object item : bookList) {
                if (item == null) {
                    continue;
                }
                Book incoming;
                try {
                    incoming = GSON.fromJson(GSON.toJson(item), Book.class);
                } catch (Exception e) {
                    continue;
                }
                if (incoming == null) {
                    continue;
                }
                String bookUrl = incoming.getBookUrl();
                if ((bookUrl == null || bookUrl.isEmpty()) && incoming.getName() != null
                        && incoming.getAuthor() != null) {
                    if (shelfBooks == null) {
                        shelfBooks = bookService.getShelfBookList(finalUser);
                    }
                    for (Book shelfBook : shelfBooks) {
                        if (shelfBook == null) {
                            continue;
                        }
                        if (incoming.getName().equals(shelfBook.getName())
                                && incoming.getAuthor().equals(shelfBook.getAuthor())) {
                            bookUrl = shelfBook.getBookUrl();
                            break;
                        }
                    }
                }
                if (bookUrl == null || bookUrl.isEmpty()) {
                    continue;
                }

                Book shelfBook = bookService.getShelfBookByURL(bookUrl, finalUser);
                if (shelfBook == null) {
                    continue;
                }
                Integer currentGroup = shelfBook.getGroup();
                int nextGroup = (currentGroup == null ? 0 : currentGroup) ^ groupId;
                shelfBook.setGroup(nextGroup);
                bookService.saveBook(shelfBook, finalUser);
            }

            return ReturnData.success("");
        } catch (Exception e) {
            log.error("批量移除分组失败", e);
            return ReturnData.error("批量移除分组失败: " + e.getMessage());
        }
    }

    @PostMapping(value = "/importBookPreview", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReturnData importBookPreview(@RequestParam Map<String, MultipartFile> files,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            if (files == null || files.isEmpty()) {
                return ReturnData.error("请上传书籍文件");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String assetsPath = storageHelper.getAssetsPath(finalUser);
            List<Map<String, Object>> fileList = new ArrayList<>();

            for (MultipartFile file : files.values()) {
                if (file == null || file.isEmpty()) {
                    continue;
                }

                String originalName = file.getOriginalFilename();
                if (originalName == null) {
                    originalName = "book.txt";
                }
                originalName = originalName.replaceAll("^.*[\\\\/]", "");
                int dotIndex = originalName.lastIndexOf('.');
                String ext = dotIndex >= 0 ? originalName.substring(dotIndex + 1).toLowerCase() : "";
                if (!"txt".equals(ext) && !"epub".equals(ext) && !"umd".equals(ext) && !"cbz".equals(ext)) {
                    return ReturnData.error("不支持导入" + ext + "格式的书籍文件");
                }

                String baseName = dotIndex > 0 ? originalName.substring(0, dotIndex) : originalName;
                baseName = baseName.replaceAll("[\\\\/:*?\"<>|]", "");
                if (baseName.length() > 50) {
                    baseName = baseName.substring(0, 50);
                }
                if (baseName.isEmpty()) {
                    baseName = "book";
                }

                String fileName = baseName + "." + ext;
                String localFilePath = assetsPath + File.separator + "book" + File.separator + fileName;
                String localFileUrl = "/assets/" + finalUser + "/book/" + fileName;

                File targetFile = new File(localFilePath);
                if (!targetFile.getParentFile().exists()) {
                    targetFile.getParentFile().mkdirs();
                }
                if (targetFile.exists()) {
                    targetFile.delete();
                }
                file.transferTo(targetFile);

                Book book = new Book();
                book.setBookUrl(localFileUrl);
                book.setOrigin("local");
                book.setOriginName(localFilePath);
                book.setName(baseName);
                book.setAuthor("");
                book.setCanUpdate(false);
                book.setType(0);
                book.setRootDir(readerConfig.getWorkDir());
                book.setUserNameSpace(finalUser);

                Map<String, Object> item = new HashMap<>();
                item.put("book", book);
                item.put("chapters", new ArrayList<>());
                fileList.add(item);
            }

            return ReturnData.success(fileList);
        } catch (Exception e) {
            log.error("导入书籍预览失败", e);
            return ReturnData.error("导入书籍预览失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getLocalStoreFileList", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getLocalStoreFileList(@RequestParam(value = "path", required = false) String path,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
                if (Boolean.FALSE.equals(user.getEnableLocalStore())) {
                    return ReturnData.error("未开启本地书仓功能");
                }
            }

            String finalPath = path;
            if ((finalPath == null || finalPath.isEmpty()) && body != null && body.get("path") != null) {
                finalPath = String.valueOf(body.get("path"));
            }
            if (finalPath == null || finalPath.isEmpty()) {
                finalPath = "/";
            }

            String home = storageHelper.getLocalStorePath();
            File file = new File(home + finalPath);
            log.info("file: {} {}", finalPath, file);
            if (!file.exists()) {
                return ReturnData.error("路径不存在");
            }
            if (!file.isDirectory()) {
                return ReturnData.error("路径不是目录");
            }

            List<Map<String, Object>> fileList = new ArrayList<>();
            File[] files = file.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (f == null) {
                        continue;
                    }
                    String name = f.getName();
                    if (name != null && name.startsWith(".")) {
                        continue;
                    }
                    Map<String, Object> item = new HashMap<>();
                    item.put("name", f.getName());
                    item.put("size", f.length());
                    item.put("path", f.toString().replace(home, ""));
                    item.put("lastModified", f.lastModified());
                    item.put("isDirectory", f.isDirectory());
                    fileList.add(item);
                }
            }

            return ReturnData.success(fileList);
        } catch (Exception e) {
            log.error("获取本地书仓文件列表失败", e);
            return ReturnData.error("获取本地书仓文件列表失败: " + e.getMessage());
        }
    }

    @PostMapping("/importFromLocalPathPreview")
    public ReturnData importFromLocalPathPreview(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            if (body == null) {
                return ReturnData.error("参数错误");
            }
            Object pathObj = body.get("path");
            if (!(pathObj instanceof List<?>)) {
                return ReturnData.error("参数错误");
            }
            boolean webdav = false;
            Object webdavObj = body.get("webdav");
            if (webdavObj instanceof Boolean) {
                webdav = (Boolean) webdavObj;
            } else if (webdavObj != null) {
                webdav = Boolean.parseBoolean(String.valueOf(webdavObj));
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
                if (webdav && Boolean.FALSE.equals(user.getEnableWebdav())) {
                    return ReturnData.error("未开启 Webdav 功能");
                } else if (!webdav && Boolean.FALSE.equals(user.getEnableLocalStore())) {
                    return ReturnData.error("未开启本地书仓功能");
                }
            }

            String home;
            if (webdav) {
                home = storageHelper.getUserDataPath(finalUser) + File.separator + "webdav";
                File dir = new File(home);
                if (!dir.exists()) {
                    dir.mkdirs();
                }
            } else {
                home = storageHelper.getLocalStorePath();
            }

            List<Map<String, Object>> fileList = new ArrayList<>();
            List<?> paths = (List<?>) pathObj;
            for (Object item : paths) {
                if (item == null) {
                    continue;
                }
                String path = String.valueOf(item);
                if (path.isEmpty()) {
                    continue;
                }
                String fullPath = home + path;
                File file = new File(fullPath);
                log.info("localFile: {} {}", fullPath, file);
                if (!file.exists()) {
                    continue;
                }

                String fileName = file.getName();
                int dotIndex = fileName.lastIndexOf('.');
                String ext = dotIndex >= 0 ? fileName.substring(dotIndex + 1).toLowerCase() : "";
                if (!"txt".equals(ext) && !"epub".equals(ext) && !"umd".equals(ext) && !"cbz".equals(ext)) {
                    return ReturnData.error("不支持导入" + ext + "格式的书籍文件");
                }

                String baseName = dotIndex > 0 ? fileName.substring(0, dotIndex) : fileName;
                Book book = new Book();
                book.setBookUrl(fullPath);
                book.setOrigin("local");
                book.setOriginName(fullPath);
                book.setName(baseName);
                book.setAuthor("");
                book.setCanUpdate(false);
                book.setType(0);
                book.setRootDir(readerConfig.getWorkDir());
                book.setUserNameSpace(finalUser);

                Map<String, Object> result = new HashMap<>();
                result.put("book", book);
                result.put("chapters", new ArrayList<>());
                fileList.add(result);
            }

            return ReturnData.success(fileList);
        } catch (Exception e) {
            log.error("本地导入预览失败", e);
            return ReturnData.error("本地导入预览失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/deleteLocalStoreFile", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData deleteLocalStoreFile(@RequestParam(value = "path", required = false) String path,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS,
            @RequestParam(value = "secureKey", required = false) String secureKey) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
                if (Boolean.FALSE.equals(user.getEnableLocalStore())) {
                    return ReturnData.error("未开启本地书仓功能");
                }
            }

            String configKey = readerConfig.getSecureKey();
            if (configKey != null && !configKey.isEmpty()) {
                if (secureKey == null || secureKey.isEmpty() || !configKey.equals(secureKey)) {
                    return new ReturnData(false, "请输入管理密码", "NEED_SECURE_KEY");
                }
            }

            String finalPath = path;
            if ((finalPath == null || finalPath.isEmpty()) && body != null && body.get("path") != null) {
                finalPath = String.valueOf(body.get("path"));
            }
            if (finalPath == null || finalPath.isEmpty()) {
                return ReturnData.error("参数错误");
            }

            String home = storageHelper.getLocalStorePath();
            File file = new File(home + finalPath);
            log.info("file: {} {}", finalPath, file);
            if (!file.exists()) {
                return ReturnData.error("路径不存在");
            }
            if (!deleteRecursively(file)) {
                return ReturnData.error("删除失败");
            }

            return ReturnData.success("");
        } catch (Exception e) {
            log.error("删除本地书仓文件失败", e);
            return ReturnData.error("删除本地书仓文件失败: " + e.getMessage());
        }
    }

    @PostMapping(value = "/uploadFileToLocalStore", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ReturnData uploadFileToLocalStore(@RequestParam Map<String, MultipartFile> files,
            @RequestParam(value = "path", required = false) String path,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS,
            @RequestParam(value = "secureKey", required = false) String secureKey) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            if (files == null || files.isEmpty()) {
                return ReturnData.error("请上传文件");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
                if (Boolean.FALSE.equals(user.getEnableLocalStore())) {
                    return ReturnData.error("未开启本地书仓功能");
                }
            }

            String configKey = readerConfig.getSecureKey();
            if (configKey != null && !configKey.isEmpty()) {
                if (secureKey == null || secureKey.isEmpty() || !configKey.equals(secureKey)) {
                    return new ReturnData(false, "请输入管理密码", "NEED_SECURE_KEY");
                }
            }

            String finalPath = path == null ? "" : path;
            String home = storageHelper.getLocalStorePath();
            List<Map<String, Object>> fileList = new ArrayList<>();

            for (MultipartFile file : files.values()) {
                if (file == null || file.isEmpty()) {
                    continue;
                }
                String fileName = file.getOriginalFilename();
                if (fileName == null || fileName.isEmpty()) {
                    fileName = "file";
                }
                fileName = fileName.replaceAll("^.*[\\\\/]", "");
                File newFile = new File(home + File.separator + finalPath + File.separator + fileName);
                if (!newFile.getParentFile().exists()) {
                    newFile.getParentFile().mkdirs();
                }
                if (newFile.exists()) {
                    newFile.delete();
                }
                log.info("moveTo: {}", newFile);
                file.transferTo(newFile);

                Map<String, Object> item = new HashMap<>();
                item.put("name", newFile.getName());
                item.put("size", newFile.length());
                item.put("path", newFile.toString().replace(home, ""));
                item.put("lastModified", newFile.lastModified());
                item.put("isDirectory", newFile.isDirectory());
                fileList.add(item);
            }

            return ReturnData.success(fileList);
        } catch (Exception e) {
            log.error("上传本地书仓文件失败", e);
            return ReturnData.error("上传本地书仓文件失败: " + e.getMessage());
        }
    }

    @PostMapping(value = "/deleteLocalStoreFileList")
    public ReturnData deleteLocalStoreFileList(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS,
            @RequestParam(value = "secureKey", required = false) String secureKey) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
                if (Boolean.FALSE.equals(user.getEnableLocalStore())) {
                    return ReturnData.error("未开启本地书仓功能");
                }
            }

            String configKey = readerConfig.getSecureKey();
            if (configKey != null && !configKey.isEmpty()) {
                if (secureKey == null || secureKey.isEmpty() || !configKey.equals(secureKey)) {
                    return new ReturnData(false, "请输入管理密码", "NEED_SECURE_KEY");
                }
            }

            if (body == null) {
                return ReturnData.error("参数错误");
            }
            Object pathObj = body.get("path");
            if (!(pathObj instanceof List<?>)) {
                return ReturnData.error("参数错误");
            }

            String home = storageHelper.getLocalStorePath();
            List<?> paths = (List<?>) pathObj;
            for (Object item : paths) {
                if (item == null) {
                    continue;
                }
                String filePath = String.valueOf(item);
                if (filePath.isEmpty()) {
                    continue;
                }
                File file = new File(home + filePath);
                deleteRecursively(file);
            }

            return ReturnData.success("");
        } catch (Exception e) {
            log.error("批量删除本地书仓文件失败", e);
            return ReturnData.error("批量删除本地书仓文件失败: " + e.getMessage());
        }
    }

    private boolean deleteRecursively(File file) {
        if (file == null) {
            return false;
        }
        if (file.isDirectory()) {
            File[] files = file.listFiles();
            if (files != null) {
                for (File f : files) {
                    deleteRecursively(f);
                }
            }
        }
        return file.delete();
    }

    @RequestMapping(value = "/saveBookGroupId", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData saveBookGroupId(@RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "groupId", required = false) Integer groupId,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = bookUrl;
            Integer finalGroupId = groupId;
            if (body != null) {
                if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                }
                if (finalGroupId == null && body.get("groupId") instanceof Number) {
                    finalGroupId = ((Number) body.get("groupId")).intValue();
                }
            }

            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("书籍链接不能为空");
            }
            if (finalGroupId == null || finalGroupId <= 0) {
                return ReturnData.error("分组信息错误");
            }

            Book book = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            if (book == null) {
                return ReturnData.error("书籍信息错误");
            }

            book.setGroup(finalGroupId);
            boolean ok = bookService.saveBook(book, finalUser);
            if (!ok) {
                return ReturnData.error("保存失败");
            }

            return ReturnData.success(book);
        } catch (Exception e) {
            log.error("设置分组失败", e);
            return ReturnData.error("设置分组失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/setBookSource", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData setBookSource(@RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "newUrl", required = false) String newUrl,
            @RequestParam(value = "bookSourceUrl", required = false) String bookSourceUrl,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS,
            @RequestBody(required = false) Map<String, Object> body) {
        try {
            // 权限验证
            String finalAccessToken = accessToken;
            if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null && body.get("accessToken") != null) {
                finalAccessToken = String.valueOf(body.get("accessToken"));
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())
                    && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            // 获取用户命名空间
            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null && !finalAccessToken.isEmpty()) {
                String[] parts = finalAccessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())) {
                User user = userService.getUserByUsername(finalUser);
                if (user == null) {
                    return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                }
            }

            // 参数获取
            String finalBookUrl = bookUrl;
            String finalNewUrl = newUrl;
            String finalBookSourceUrl = bookSourceUrl;

            if (body != null) {
                if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                    finalBookUrl = (String) body.get("bookUrl");
                }
                if (finalNewUrl == null || finalNewUrl.isEmpty()) {
                    finalNewUrl = (String) body.get("newUrl");
                }
                if (finalBookSourceUrl == null || finalBookSourceUrl.isEmpty()) {
                    finalBookSourceUrl = (String) body.get("bookSourceUrl");
                }
            }

            // 参数验证
            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("书籍链接不能为空");
            }
            if (finalNewUrl == null || finalNewUrl.isEmpty()) {
                return ReturnData.error("新源书籍链接不能为空");
            }
            if (finalBookSourceUrl == null || finalBookSourceUrl.isEmpty()) {
                return ReturnData.error("书源链接不能为空");
            }

            // 获取书架上的书籍
            Book book = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            if (book == null) {
                return ReturnData.error("书籍信息错误");
            }

            // 查找书源
            BookSource bookSource = bookSourceService.getBookSourceByUrl(finalBookSourceUrl, finalUser);
            Book newBookInfo = null;

            if (bookSource == null) {
                // 书源不存在于用户书源列表，尝试从本地搜索缓存中查找
                SearchBook searchBook = findSearchBookFromLocalCache(
                        book.getName(), book.getAuthor(), finalNewUrl, finalUser);
                if (searchBook == null) {
                    return ReturnData.error("书源信息错误");
                }
                newBookInfo = searchBook.toBook();
            } else {
                // 从书源获取书籍详情
                newBookInfo = webBookService.getBookInfo(bookSource, finalNewUrl);
            }

            // 更新书籍信息
            book.setOrigin(newBookInfo.getOrigin());
            book.setOriginName(newBookInfo.getOriginName());
            book.setBookUrl(newBookInfo.getBookUrl());
            book.setTocUrl(newBookInfo.getTocUrl());

            // 仅在原封面为空时更新封面
            if ((book.getCoverUrl() == null || book.getCoverUrl().isEmpty())
                    && newBookInfo.getCoverUrl() != null && !newBookInfo.getCoverUrl().isEmpty()) {
                book.setCoverUrl(newBookInfo.getCoverUrl());
            }

            log.info("setBookSource: {}", book);

            // 保存更新后的书籍
            bookService.saveBook(book, finalUser);

            // 更新章节目录
            if (bookSource != null) {
                try {
                    List<BookChapter> chapterList = webBookService.getChapterList(bookSource, book);
                    if (chapterList != null && !chapterList.isEmpty()) {
                        for (BookChapter ch : chapterList) {
                            ch.setBookUrl(book.getBookUrl());
                        }
                        bookService.saveChapterList(book.getBookUrl(), chapterList, finalUser);
                    }
                } catch (Exception e) {
                    log.warn("更新章节列表失败: {}", e.getMessage());
                }
            }

            return ReturnData.success(book);
        } catch (Exception e) {
            log.error("设置书源失败", e);
            return ReturnData.error("设置书源失败: " + e.getMessage());
        }
    }

    /**
     * 从本地缓存中查找搜索书籍
     */
    private SearchBook findSearchBookFromLocalCache(String bookName, String bookAuthor,
            String targetBookUrl, String username) {
        try {
            String key = bookName + "_" + bookAuthor;
            String cachePath = storageHelper.getUserDataPath(username)
                    + File.separator + key + File.separator + "bookSource.json";

            String json = storageHelper.readFile(cachePath);
            if (json == null || json.isEmpty()) {
                return null;
            }

            Type listType = new TypeToken<List<SearchBook>>() {}.getType();
            List<SearchBook> searchBooks = GSON.fromJson(json, listType);

            if (searchBooks != null) {
                for (SearchBook sb : searchBooks) {
                    if (targetBookUrl.equals(sb.getBookUrl())) {
                        return sb;
                    }
                }
            }
        } catch (Exception e) {
            log.warn("从本地缓存查找搜索书籍失败: {}", e.getMessage());
        }
        return null;
    }

    @GetMapping(value = "/cacheBookSSE", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter cacheBookSSE(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "refresh", defaultValue = "0") int refresh,
            @RequestParam(value = "concurrentCount", defaultValue = "24") int concurrentCount,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        SseEmitter emitter = new SseEmitter(0L);
        AtomicBoolean canceled = new AtomicBoolean(false);

        ExecutorService executor = Executors.newSingleThreadExecutor();
        emitter.onCompletion(() -> {
            canceled.set(true);
            executor.shutdownNow();
        });
        emitter.onTimeout(() -> {
            canceled.set(true);
            executor.shutdownNow();
        });
        emitter.onError((e) -> {
            canceled.set(true);
            executor.shutdownNow();
        });

        executor.execute(() -> {
            try {
                if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                    ReturnData rd = new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                        : (username != null && !username.isEmpty()) ? username : null;
                if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                    String[] parts = accessToken.split(":", 2);
                    if (parts.length >= 1 && !parts[0].isEmpty()) {
                        finalUser = parts[0];
                    }
                }
                if (finalUser == null || finalUser.isEmpty()) {
                    finalUser = "default";
                }
                final String userName = finalUser;

                String finalBookUrl = (url != null && !url.isEmpty()) ? url : bookUrl;
                if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                    ReturnData rd = ReturnData.error("请输入书籍链接");
                    try {
                        emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    } catch (Exception ignore) {
                    }
                    emitter.complete();
                    return;
                }

                Book bookInfo = bookService.getShelfBookByURL(finalBookUrl, userName);
                if (bookInfo == null) {
                    ReturnData rd = ReturnData.error("请先加入书架");
                    try {
                        emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    } catch (Exception ignore) {
                    }
                    emitter.complete();
                    return;
                }
                if (bookInfo.isLocalBook() || "loc_book".equals(bookInfo.getOrigin())) {
                    ReturnData rd = ReturnData.error("本地书籍无需缓存");
                    try {
                        emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    } catch (Exception ignore) {
                    }
                    emitter.complete();
                    return;
                }

                BookSource bookSource = bookSourceService.getBookSourceByUrl(bookInfo.getOrigin(), userName);
                if (bookSource == null) {
                    ReturnData rd = ReturnData.error("未配置书源");
                    try {
                        emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    } catch (Exception ignore) {
                    }
                    emitter.complete();
                    return;
                }

                List<BookChapter> chapterList = bookService.getChapterList(finalBookUrl, userName);
                if (refresh > 0 || chapterList == null || chapterList.isEmpty()) {
                    chapterList = webBookService.getChapterList(bookSource, bookInfo);
                    if (chapterList != null && !chapterList.isEmpty()) {
                        bookService.saveChapterList(finalBookUrl, chapterList, userName);
                    }
                }
                if (chapterList == null) {
                    chapterList = new ArrayList<>();
                }
                if (chapterList.isEmpty()) {
                    ReturnData rd = ReturnData.error("章节列表为空");
                    try {
                        emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    } catch (Exception ignore) {
                    }
                    emitter.complete();
                    return;
                }

                Set<Integer> cachedSet = java.util.Collections.synchronizedSet(new HashSet<>());
                if (refresh <= 0) {
                    String bookDir = storageHelper.getUserDataPath(userName) + File.separator + "shelf" + File.separator
                            + MD5Utils.md5Encode16(finalBookUrl);
                    File dir = new File(bookDir);
                    File[] cached = dir.listFiles(f -> f != null && f.isFile() && f.getName().startsWith("content_")
                            && f.getName().endsWith(".txt"));
                    if (cached != null) {
                        for (File f : cached) {
                            try {
                                String name = f.getName();
                                String idx = name.substring("content_".length(), name.length() - ".txt".length());
                                cachedSet.add(Integer.parseInt(idx));
                            } catch (Exception ignore) {
                            }
                        }
                    }
                }

                int effectiveConcurrent = concurrentCount > 0 ? concurrentCount : 24;
                ExecutorService fetchPool = Executors.newFixedThreadPool(effectiveConcurrent);
                AtomicInteger successCount = new AtomicInteger(0);
                AtomicInteger failedCount = new AtomicInteger(0);
                AtomicBoolean failed = new AtomicBoolean(false);
                Object sendLock = new Object();

                emitter.onCompletion(() -> {
                    canceled.set(true);
                    fetchPool.shutdownNow();
                });
                emitter.onTimeout(() -> {
                    canceled.set(true);
                    fetchPool.shutdownNow();
                });
                emitter.onError((e) -> {
                    canceled.set(true);
                    fetchPool.shutdownNow();
                });

                List<Runnable> tasks = new ArrayList<>();
                for (int i = 0; i < chapterList.size(); i++) {
                    int chapterIndex = i;
                    if (refresh <= 0 && cachedSet.contains(chapterIndex)) {
                        continue;
                    }
                    BookChapter chapter = chapterList.get(chapterIndex);
                    tasks.add(() -> {
                        if (canceled.get() || failed.get()) {
                            return;
                        }
                        try {
                            String content = webBookService.getChapterContent(bookSource, chapter);
                            if (content == null || content.isEmpty()) {
                                throw new RuntimeException("章节内容为空");
                            }
                            boolean ok = bookService.saveChapterContent(finalBookUrl, chapterIndex, content, userName);
                            if (!ok) {
                                throw new RuntimeException("写入缓存失败");
                            }
                            cachedSet.add(chapterIndex);
                            int cachedCount = cachedSet.size();
                            successCount.incrementAndGet();
                            synchronized (sendLock) {
                                if (!canceled.get()) {
                                    try {
                                        emitter.send(SseEmitter.event()
                                                .data(GSON.toJson(Map.of("cachedCount", cachedCount)),
                                                        MediaType.APPLICATION_JSON));
                                    } catch (Exception ignore) {
                                    }
                                }
                            }
                        } catch (Exception e) {
                            failed.set(true);
                            failedCount.incrementAndGet();
                            synchronized (sendLock) {
                                if (!canceled.get()) {
                                    ReturnData rd = ReturnData.error("缓存失败: " + e.getMessage());
                                    try {
                                        emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd),
                                                MediaType.APPLICATION_JSON));
                                    } catch (Exception ignore) {
                                    }
                                }
                            }
                        }
                    });
                }

                for (Runnable t : tasks) {
                    if (canceled.get() || failed.get()) {
                        break;
                    }
                    fetchPool.execute(t);
                }
                fetchPool.shutdown();
                while (!fetchPool.isTerminated()) {
                    if (canceled.get() || failed.get()) {
                        fetchPool.shutdownNow();
                        break;
                    }
                    try {
                        Thread.sleep(200);
                    } catch (InterruptedException e) {
                        break;
                    }
                }

                if (canceled.get()) {
                    emitter.complete();
                    return;
                }
                if (failed.get()) {
                    emitter.complete();
                    return;
                }

                Map<String, Object> end = new HashMap<>();
                end.put("cachedCount", cachedSet.size());
                end.put("successCount", successCount.get());
                end.put("failedCount", failedCount.get());
                try {
                    emitter.send(SseEmitter.event().name("end").data(GSON.toJson(end), MediaType.APPLICATION_JSON));
                } catch (Exception ignore) {
                }
                emitter.complete();
            } catch (Exception e) {
                try {
                    ReturnData rd = ReturnData.error(e.getMessage() == null ? "缓存失败" : e.getMessage());
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                } catch (Exception ignore) {
                }
                emitter.complete();
            }
        });

        return emitter;
    }

    @RequestMapping(value = "/searchBookMultiSSE", method = { RequestMethod.GET,
            RequestMethod.POST }, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter searchBookMultiSSE(@RequestParam(value = "key", required = false) String key,
            @RequestParam(value = "bookSourceGroup", required = false) String bookSourceGroup,
            @RequestParam(value = "lastIndex", required = false) Integer lastIndex,
            @RequestParam(value = "searchSize", required = false) Integer searchSize,
            @RequestParam(value = "concurrentCount", required = false) Integer concurrentCount,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        SseEmitter emitter = new SseEmitter(0L);
        AtomicBoolean canceled = new AtomicBoolean(false);

        ExecutorService executor = Executors.newSingleThreadExecutor();
        emitter.onCompletion(() -> {
            canceled.set(true);
            executor.shutdownNow();
        });
        emitter.onTimeout(() -> {
            canceled.set(true);
            executor.shutdownNow();
        });
        emitter.onError((e) -> {
            canceled.set(true);
            executor.shutdownNow();
        });

        executor.execute(() -> {
            try {
                if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                    ReturnData rd = new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                        : (username != null && !username.isEmpty()) ? username : null;
                if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                    String[] parts = accessToken.split(":", 2);
                    if (parts.length >= 1 && !parts[0].isEmpty()) {
                        finalUser = parts[0];
                    }
                }
                if (finalUser == null || finalUser.isEmpty()) {
                    finalUser = "default";
                }

                String finalKey = key;
                String finalGroup = bookSourceGroup;
                Integer finalLastIndex = lastIndex;
                Integer finalSearchSize = searchSize;
                Integer finalConcurrent = concurrentCount;
                if (body != null) {
                    if ((finalKey == null || finalKey.isEmpty()) && body.get("key") != null) {
                        finalKey = String.valueOf(body.get("key"));
                    }
                    if (finalGroup == null && body.get("bookSourceGroup") != null) {
                        finalGroup = String.valueOf(body.get("bookSourceGroup"));
                    }
                    if (finalLastIndex == null && body.get("lastIndex") instanceof Number) {
                        finalLastIndex = ((Number) body.get("lastIndex")).intValue();
                    }
                    if (finalSearchSize == null && body.get("searchSize") instanceof Number) {
                        finalSearchSize = ((Number) body.get("searchSize")).intValue();
                    }
                    if (finalConcurrent == null && body.get("concurrentCount") instanceof Number) {
                        finalConcurrent = ((Number) body.get("concurrentCount")).intValue();
                    }
                }

                int startIndex = finalLastIndex == null ? -1 : finalLastIndex;
                int sizeLimit = finalSearchSize == null || finalSearchSize <= 0 ? 50 : finalSearchSize;
                int concurrent = finalConcurrent == null || finalConcurrent <= 0 ? 24 : finalConcurrent;

                final String searchKey = finalKey;
                List<BookSource> sources = bookSourceService.getBookSourcesByGroup(finalGroup, finalUser);
                if (sources == null || sources.isEmpty()) {
                    ReturnData rd = ReturnData.error("未配置书源");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }
                if (finalKey == null || finalKey.isEmpty()) {
                    ReturnData rd = ReturnData.error("请输入搜索关键字");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }
                if (startIndex >= sources.size() - 1) {
                    ReturnData rd = ReturnData.error("没有更多了");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                List<SearchBook> resultList = new ArrayList<>();
                Set<String> resultMap = new HashSet<>();
                int currentIndex = startIndex;

                while (!canceled.get() && currentIndex < sources.size() - 1 && resultList.size() < sizeLimit) {
                    int batchStart = currentIndex + 1;
                    int batchEnd = Math.min(batchStart + concurrent, sources.size());
                    ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, batchEnd - batchStart));
                    List<Callable<List<SearchBook>>> tasks = new ArrayList<>();
                    for (int i = batchStart; i < batchEnd; i++) {
                        BookSource bookSource = sources.get(i);
                        tasks.add(() -> {
                            try {
                                return webBookService.searchBook(bookSource, searchKey, 1);
                            } catch (Exception e) {
                                log.warn("搜索书源失败: {}", bookSource.getBookSourceName(), e);
                                return new ArrayList<>();
                            }
                        });
                    }

                    List<Future<List<SearchBook>>> futures = new ArrayList<>();
                    for (Callable<List<SearchBook>> task : tasks) {
                        futures.add(pool.submit(task));
                    }
                    pool.shutdown();

                    List<SearchBook> loopResult = new ArrayList<>();
                    for (Future<List<SearchBook>> future : futures) {
                        if (canceled.get()) {
                            break;
                        }
                        List<SearchBook> books;
                        try {
                            books = future.get();
                        } catch (Exception e) {
                            continue;
                        }
                        if (books == null) {
                            continue;
                        }
                        for (SearchBook book : books) {
                            if (book == null) {
                                continue;
                            }
                            // 缓存搜索到的书籍信息
                            bookService.cacheBookInfo(book.toBook());

                            String author = book.getAuthor() == null ? "" : book.getAuthor();
                            String name = book.getName() == null ? "" : book.getName();
                            String bookKey = name + "_" + author;
                            if (!resultMap.contains(bookKey)) {
                                resultMap.add(bookKey);
                                resultList.add(book);
                                loopResult.add(book);
                            }
                        }
                    }

                    currentIndex = batchEnd - 1;
                    Map<String, Object> payload = new HashMap<>();
                    payload.put("lastIndex", currentIndex);
                    payload.put("data", loopResult);
                    emitter.send(SseEmitter.event().name("message").data(GSON.toJson(payload), MediaType.APPLICATION_JSON));
                }

                Map<String, Object> end = new HashMap<>();
                end.put("lastIndex", currentIndex);
                emitter.send(SseEmitter.event().name("end").data(GSON.toJson(end), MediaType.APPLICATION_JSON));
                emitter.complete();
            } catch (Exception e) {
                try {
                    ReturnData rd = ReturnData.error(e.getMessage() == null ? "搜索失败" : e.getMessage());
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                } catch (Exception ignore) {
                }
                emitter.complete();
            }
        });

        return emitter;
    }

    @RequestMapping(value = "/searchBookSourceSSE", method = { RequestMethod.GET,
            RequestMethod.POST }, produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter searchBookSourceSSE(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "lastIndex", required = false) Integer lastIndex,
            @RequestParam(value = "searchSize", required = false) Integer searchSize,
            @RequestParam(value = "bookSourceGroup", required = false) String bookSourceGroup,
            @RequestParam(value = "refresh", required = false) Integer refresh,
            @RequestParam(value = "concurrentCount", required = false) Integer concurrentCount,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        SseEmitter emitter = new SseEmitter(0L);
        AtomicBoolean canceled = new AtomicBoolean(false);

        ExecutorService executor = Executors.newSingleThreadExecutor();
        emitter.onCompletion(() -> {
            canceled.set(true);
            executor.shutdownNow();
        });
        emitter.onTimeout(() -> {
            canceled.set(true);
            executor.shutdownNow();
        });
        emitter.onError((e) -> {
            canceled.set(true);
            executor.shutdownNow();
        });

        executor.execute(() -> {
            ExecutorService pool = null;
            try {
                String finalAccessToken = accessToken;
                if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null
                        && body.get("accessToken") != null) {
                    finalAccessToken = String.valueOf(body.get("accessToken"));
                }

                if (Boolean.TRUE.equals(readerConfig.getSecure())
                        && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                    ReturnData rd = new ReturnData(false, "请登录后使用", "NEED_LOGIN");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                        : (username != null && !username.isEmpty()) ? username : null;
                if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null
                        && !finalAccessToken.isEmpty()) {
                    String[] parts = finalAccessToken.split(":", 2);
                    if (parts.length >= 1 && !parts[0].isEmpty()) {
                        finalUser = parts[0];
                    }
                }
                if (finalUser == null || finalUser.isEmpty()) {
                    finalUser = "default";
                }

                String finalUrl = url;
                Integer finalLastIndex = lastIndex;
                Integer finalSearchSize = searchSize;
                String finalGroup = bookSourceGroup;
                Integer finalRefresh = refresh;
                Integer finalConcurrent = concurrentCount;
                if (body != null) {
                    if ((finalUrl == null || finalUrl.isEmpty()) && body.get("url") != null) {
                        finalUrl = String.valueOf(body.get("url"));
                    }
                    if (finalLastIndex == null && body.get("lastIndex") instanceof Number) {
                        finalLastIndex = ((Number) body.get("lastIndex")).intValue();
                    }
                    if (finalSearchSize == null && body.get("searchSize") instanceof Number) {
                        finalSearchSize = ((Number) body.get("searchSize")).intValue();
                    }
                    if (finalGroup == null && body.get("bookSourceGroup") != null) {
                        finalGroup = String.valueOf(body.get("bookSourceGroup"));
                    }
                    if (finalRefresh == null && body.get("refresh") instanceof Number) {
                        finalRefresh = ((Number) body.get("refresh")).intValue();
                    }
                    if (finalConcurrent == null && body.get("concurrentCount") instanceof Number) {
                        finalConcurrent = ((Number) body.get("concurrentCount")).intValue();
                    }
                }

                int startIndex = finalLastIndex == null ? -1 : finalLastIndex;
                int sizeLimit = finalSearchSize == null || finalSearchSize <= 0 ? 30 : finalSearchSize;
                int refreshFlag = finalRefresh == null ? 0 : finalRefresh;

                List<BookSource> sources = bookSourceService.getBookSourcesByGroup(finalGroup, finalUser);
                if (sources == null || sources.isEmpty()) {
                    ReturnData rd = ReturnData.error("未配置书源");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }
                if (finalUrl == null || finalUrl.isEmpty()) {
                    ReturnData rd = ReturnData.error("请输入书籍链接");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                Book book = bookService.getShelfBookByURL(finalUrl, finalUser);
                if (book == null) {
                    ReturnData rd = ReturnData.error("书籍信息错误");
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                String bookName = book.getName() == null ? "" : book.getName();
                String bookAuthor = book.getAuthor() == null ? "" : book.getAuthor();
                String bookSourcePath = storageHelper.getUserDataPath(finalUser) + File.separator + bookName + "_"
                        + bookAuthor + File.separator + "bookSource.json";
                File bookSourceFile = new File(bookSourcePath);

                List<SearchBook> localSources = new ArrayList<>();
                if (bookSourceFile.exists() && refreshFlag <= 0) {
                    String json = storageHelper.readFile(bookSourcePath);
                    if (json != null && !json.isEmpty()) {
                        try {
                            Type listType = new TypeToken<List<SearchBook>>() {
                            }.getType();
                            List<SearchBook> parsed = GSON.fromJson(json, listType);
                            if (parsed != null) {
                                localSources = parsed;
                            }
                        } catch (Exception e) {
                            log.warn("解析书源缓存失败: {}", bookSourcePath, e);
                        }
                    }
                }

                if (!localSources.isEmpty() && refreshFlag <= 0) {
                    try {
                        Map<String, Integer> sourceIndex = new HashMap<>();
                        for (int i = 0; i < sources.size(); i++) {
                            BookSource bs = sources.get(i);
                            if (bs != null && bs.getBookSourceUrl() != null && !bs.getBookSourceUrl().isEmpty()) {
                                sourceIndex.put(bs.getBookSourceUrl(), i);
                            }
                        }
                        SearchBook last = localSources.get(localSources.size() - 1);
                        if (last != null && last.getOrigin() != null && !last.getOrigin().isEmpty()) {
                            int idx = sourceIndex.getOrDefault(last.getOrigin(), -1);
                            startIndex = Math.max(startIndex, idx);
                        }
                    } catch (Exception e) {
                        log.warn("校正 lastIndex 失败", e);
                    }
                }

                if (startIndex >= sources.size() - 1) {
                    ReturnData rd = new ReturnData(false, "没有更多了", Map.of("lastIndex", startIndex));
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                    emitter.complete();
                    return;
                }

                int computedConcurrent = Math.max(sizeLimit * 2, 24);
                if (finalConcurrent != null && finalConcurrent > 0) {
                    computedConcurrent = Math.max(computedConcurrent, finalConcurrent);
                }

                List<SearchBook> resultList = new ArrayList<>();
                int currentIndex = startIndex;

                while (!canceled.get() && currentIndex < sources.size() - 1 && resultList.size() < sizeLimit) {
                    int batchStart = currentIndex + 1;
                    int batchEnd = Math.min(batchStart + computedConcurrent, sources.size());
                    pool = Executors.newFixedThreadPool(Math.max(1, batchEnd - batchStart));

                    List<Callable<List<SearchBook>>> tasks = new ArrayList<>();
                    for (int i = batchStart; i < batchEnd; i++) {
                        final BookSource bookSource = sources.get(i);
                        tasks.add(() -> {
                            try {
                                long start = System.currentTimeMillis();
                                List<SearchBook> books = webBookService.searchBook(bookSource, bookName, 1);
                                long end = System.currentTimeMillis();
                                if (books == null) {
                                    return new ArrayList<>();
                                }
                                List<SearchBook> filtered = new ArrayList<>();
                                for (SearchBook item : books) {
                                    if (item == null) {
                                        continue;
                                    }
                                    String name = item.getName() == null ? "" : item.getName();
                                    String author = item.getAuthor() == null ? "" : item.getAuthor();
                                    if (name.equals(bookName) && author.equals(bookAuthor)) {
                                        item.setTime(end - start);
                                        filtered.add(item);
                                    }
                                }
                                return filtered;
                            } catch (Exception e) {
                                log.warn("搜索书源失败: {}", bookSource == null ? "" : bookSource.getBookSourceName(), e);
                                return new ArrayList<>();
                            }
                        });
                    }

                    List<Future<List<SearchBook>>> futures = new ArrayList<>();
                    for (Callable<List<SearchBook>> task : tasks) {
                        futures.add(pool.submit(task));
                    }
                    pool.shutdown();

                    List<SearchBook> loopResult = new ArrayList<>();
                    for (Future<List<SearchBook>> future : futures) {
                        if (canceled.get()) {
                            break;
                        }
                        List<SearchBook> books;
                        try {
                            books = future.get();
                        } catch (Exception e) {
                            continue;
                        }
                        if (books == null || books.isEmpty()) {
                            continue;
                        }
                        for (SearchBook sb : books) {
                            if (sb == null) {
                                continue;
                            }
                            // 缓存搜索到的书籍信息
                            bookService.cacheBookInfo(sb.toBook());

                            resultList.add(sb);
                            loopResult.add(sb);
                        }
                    }

                    currentIndex = batchEnd - 1;
                    Map<String, Object> payload = new HashMap<>();
                    payload.put("lastIndex", currentIndex);
                    payload.put("data", loopResult);
                    emitter.send(
                            SseEmitter.event().name("message").data(GSON.toJson(payload), MediaType.APPLICATION_JSON));
                }

                if (!canceled.get() && !bookName.isEmpty()) {
                    List<SearchBook> merged = new ArrayList<>();
                    if (bookSourceFile.exists()) {
                        String json = storageHelper.readFile(bookSourcePath);
                        if (json != null && !json.isEmpty()) {
                            try {
                                Type listType = new TypeToken<List<SearchBook>>() {
                                }.getType();
                                List<SearchBook> parsed = GSON.fromJson(json, listType);
                                if (parsed != null) {
                                    merged = parsed;
                                }
                            } catch (Exception e) {
                                log.warn("解析书源缓存失败: {}", bookSourcePath, e);
                            }
                        }
                    }

                    for (SearchBook sb : resultList) {
                        if (sb == null) {
                            continue;
                        }
                        int existIndex = -1;
                        for (int i = 0; i < merged.size(); i++) {
                            SearchBook exist = merged.get(i);
                            if (exist != null && exist.getBookUrl() != null && exist.getBookUrl().equals(sb.getBookUrl())) {
                                existIndex = i;
                                break;
                            }
                        }
                        if (existIndex >= 0) {
                            merged.set(existIndex, sb);
                        } else {
                            merged.add(sb);
                        }
                    }

                    storageHelper.writeFile(bookSourcePath, GSON.toJson(merged));
                }

                Map<String, Object> end = new HashMap<>();
                end.put("lastIndex", currentIndex);
                emitter.send(SseEmitter.event().name("end").data(GSON.toJson(end), MediaType.APPLICATION_JSON));
                emitter.complete();
            } catch (Exception e) {
                try {
                    ReturnData rd = ReturnData.error(e.getMessage() == null ? "搜索失败" : e.getMessage());
                    emitter.send(SseEmitter.event().name("error").data(GSON.toJson(rd), MediaType.APPLICATION_JSON));
                } catch (Exception ignore) {
                }
                emitter.complete();
            } finally {
                if (pool != null) {
                    pool.shutdownNow();
                }
            }
        });

        return emitter;
    }

    @PostMapping("/saveBookGroupOrder")
    public ReturnData saveBookGroupOrder(@RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            Object orderObj = body == null ? null : body.get("order");
            if (!(orderObj instanceof List<?>)) {
                return ReturnData.error("参数错误");
            }

            Map<Integer, Integer> orderMap = new HashMap<>();
            for (Object item : (List<?>) orderObj) {
                if (!(item instanceof Map<?, ?>)) {
                    continue;
                }
                Map<?, ?> itemMap = (Map<?, ?>) item;
                Object groupIdObj = itemMap.get("groupId");
                Object orderValObj = itemMap.get("order");
                if (!(groupIdObj instanceof Number) || !(orderValObj instanceof Number)) {
                    continue;
                }
                orderMap.put(((Number) groupIdObj).intValue(), ((Number) orderValObj).intValue());
            }

            List<Map<String, Object>> defaultGroups = new ArrayList<>();
            defaultGroups.add(new HashMap<>(Map.of("groupId", -1, "groupName", "全部", "order", -10, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -2, "groupName", "本地", "order", -9, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -3, "groupName", "音频", "order", -8, "show", true)));
            defaultGroups.add(new HashMap<>(Map.of("groupId", -4, "groupName", "未分组", "order", -7, "show", true)));

            String groupPath = storageHelper.getUserDataPath(finalUser) + File.separator + "bookGroup.json";
            String json = storageHelper.readFile(groupPath);
            Type listType = new TypeToken<List<Map<String, Object>>>() {
            }.getType();
            List<Map<String, Object>> groups = null;
            if (json != null && !json.isEmpty()) {
                groups = GSON.fromJson(json, listType);
            }
            if (groups == null || groups.isEmpty()) {
                groups = new ArrayList<>(defaultGroups);
            } else {
                Map<Integer, Map<String, Object>> byId = new HashMap<>();
                for (Map<String, Object> g : groups) {
                    if (g == null) {
                        continue;
                    }
                    Object gidObj = g.get("groupId");
                    if (gidObj instanceof Number) {
                        byId.put(((Number) gidObj).intValue(), g);
                    }
                }
                for (Map<String, Object> dg : defaultGroups) {
                    Object gidObj = dg.get("groupId");
                    if (gidObj instanceof Number) {
                        int gid = ((Number) gidObj).intValue();
                        if (!byId.containsKey(gid)) {
                            groups.add(new HashMap<>(dg));
                        }
                    }
                }
            }

            for (Map<String, Object> g : groups) {
                if (g == null) {
                    continue;
                }
                Object gidObj = g.get("groupId");
                if (!(gidObj instanceof Number)) {
                    continue;
                }
                int gid = ((Number) gidObj).intValue();
                if (orderMap.containsKey(gid)) {
                    g.put("order", orderMap.get(gid));
                }
            }

            boolean ok = storageHelper.writeFile(groupPath, GSON.toJson(groups));
            if (!ok) {
                return ReturnData.error("保存失败");
            }
            return ReturnData.success("");
        } catch (Exception e) {
            log.error("保存分组排序失败", e);
            return ReturnData.error("保存分组排序失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getShelfBookWithCacheInfo", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getShelfBookWithCacheInfo(@RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            List<Book> bookList = bookService.getShelfBookList(finalUser);
            List<Object> result = new ArrayList<>();
            Type mapType = new TypeToken<Map<String, Object>>() {
            }.getType();
            for (Book book : bookList) {
                if (book == null) {
                    continue;
                }
                if (!book.isLocalBook()) {
                    Map<String, Object> bookMap = GSON.fromJson(GSON.toJson(book), mapType);
                    if (bookMap == null) {
                        bookMap = new HashMap<>();
                    }
                    bookMap.put("cachedChapterCount", bookService.getCachedChapterCount(book.getBookUrl(), finalUser));
                    result.add(bookMap);
                } else {
                    result.add(book);
                }
            }
            return ReturnData.success(result);
        } catch (Exception e) {
            log.error("获取书架缓存信息失败", e);
            return ReturnData.error("获取书架缓存信息失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/deleteBookCache", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData deleteBookCache(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = (url != null && !url.isEmpty()) ? url : bookUrl;
            if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body != null) {
                Object v = body.get("url");
                if (v != null) {
                    finalBookUrl = String.valueOf(v);
                } else if (body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                }
            }
            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("请输入书籍链接");
            }

            Book bookInfo = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            if (bookInfo == null) {
                return ReturnData.error("请先加入书架");
            }
            if (bookInfo.isLocalBook() || "loc_book".equals(bookInfo.getOrigin())) {
                return ReturnData.error("本地书籍无需删除缓存");
            }

            String bookDir = storageHelper.getUserDataPath(finalUser) + File.separator + "shelf" + File.separator
                    + MD5Utils.md5Encode16(finalBookUrl);
            File dir = new File(bookDir);
            if (!dir.exists() || !dir.isDirectory()) {
                return ReturnData.success("");
            }

            File[] cached = dir.listFiles(
                    f -> f != null && f.isFile() && f.getName().startsWith("content_") && f.getName().endsWith(".txt"));
            if (cached != null) {
                for (File f : cached) {
                    try {
                        f.delete();
                    } catch (Exception ignore) {
                    }
                }
            }

            return ReturnData.success("");
        } catch (Exception e) {
            log.error("删除书籍缓存失败", e);
            return ReturnData.error("删除书籍缓存失败: " + e.getMessage());
        }
    }

    /**
     * 保存书籍到书架
     */
    @PostMapping("/saveBook")
    public ReturnData saveBook(@RequestBody Book book,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (book == null || book.getBookUrl() == null || book.getBookUrl().isEmpty()) {
                return ReturnData.error("书籍信息不完整");
            }

            boolean success = bookService.saveBook(book, username);
            if (success) {
                return ReturnData.success(book);
            } else {
                return ReturnData.error("保存书籍失败");
            }
        } catch (Exception e) {
            log.error("保存书籍失败", e);
            return ReturnData.error("保存书籍失败: " + e.getMessage());
        }
    }

    /**
     * 从书架删除书籍
     */
    @PostMapping("/deleteBook")
    public ReturnData deleteBook(@RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = bookUrl;
            String finalName = null;
            String finalAuthor = null;
            if (body != null) {
                if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                }
                if (body.get("name") != null) {
                    finalName = String.valueOf(body.get("name"));
                }
                if (body.get("author") != null) {
                    finalAuthor = String.valueOf(body.get("author"));
                }
            }

            if ((finalBookUrl == null || finalBookUrl.isEmpty()) && finalName != null && finalAuthor != null) {
                List<Book> shelfBooks = bookService.getShelfBookList(finalUser);
                for (Book shelfBook : shelfBooks) {
                    if (shelfBook == null) {
                        continue;
                    }
                    if (finalName.equals(shelfBook.getName()) && finalAuthor.equals(shelfBook.getAuthor())) {
                        finalBookUrl = shelfBook.getBookUrl();
                        break;
                    }
                }
            }

            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("书籍URL不能为空");
            }

            boolean success = bookService.deleteBook(finalBookUrl, finalUser);
            if (success) {
                return ReturnData.success("删除成功");
            } else {
                return ReturnData.error("删除失败");
            }
        } catch (Exception e) {
            log.error("删除书籍失败", e);
            return ReturnData.error("删除书籍失败: " + e.getMessage());
        }
    }

    @PostMapping("/deleteBooks")
    public ReturnData deleteBooks(@RequestBody(required = false) List<Book> books,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            if (Boolean.TRUE.equals(readerConfig.getSecure()) && (accessToken == null || accessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            if (books == null || books.isEmpty()) {
                return ReturnData.error("书籍列表不能为空");
            }

            List<Book> shelfBooks = null;
            for (Book book : books) {
                if (book == null) {
                    continue;
                }
                String bookUrl = book.getBookUrl();
                if ((bookUrl == null || bookUrl.isEmpty()) && book.getName() != null && book.getAuthor() != null) {
                    if (shelfBooks == null) {
                        shelfBooks = bookService.getShelfBookList(finalUser);
                    }
                    for (Book shelfBook : shelfBooks) {
                        if (shelfBook == null) {
                            continue;
                        }
                        if (book.getName().equals(shelfBook.getName())
                                && book.getAuthor().equals(shelfBook.getAuthor())) {
                            bookUrl = shelfBook.getBookUrl();
                            break;
                        }
                    }
                }
                if (bookUrl == null || bookUrl.isEmpty()) {
                    continue;
                }
                bookService.deleteBook(bookUrl, finalUser);
            }

            return ReturnData.success("");
        } catch (Exception e) {
            log.error("批量删除书籍失败", e);
            return ReturnData.error("批量删除书籍失败: " + e.getMessage());
        }
    }

    /**
     * 获取章节列表
     */
    @RequestMapping(value = "/getChapterList", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getChapterList(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "refresh", required = false) Integer refresh,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            String finalAccessToken = accessToken;
            if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null
                    && body.get("accessToken") != null) {
                finalAccessToken = String.valueOf(body.get("accessToken"));
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())
                    && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null
                    && !finalAccessToken.isEmpty()) {
                String[] parts = finalAccessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = url != null && !url.isEmpty() ? url : bookUrl;
            if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body != null) {
                Object v = body.get("url");
                if (v != null) {
                    finalBookUrl = String.valueOf(v);
                } else if (body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                } else if (body.get("book") instanceof Map<?, ?>) {
                    Object inner = ((Map<?, ?>) body.get("book")).get("bookUrl");
                    if (inner != null) {
                        finalBookUrl = String.valueOf(inner);
                    }
                }
            }

            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("请输入书籍链接");
            }

            int finalRefresh = refresh != null ? refresh : 0;
            if (body != null && body.get("refresh") != null) {
                Object v = body.get("refresh");
                if (v instanceof Number) {
                    finalRefresh = ((Number) v).intValue();
                } else {
                    try {
                        finalRefresh = Integer.parseInt(String.valueOf(v));
                    } catch (Exception ignore) {
                        finalRefresh = 0;
                    }
                }
            }

            Book bookInfo = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            BookSource bookSource = null;
            boolean isInShelf = (bookInfo != null);

            if (bookInfo == null) {
                // 书籍未加入书架，尝试从缓存获取书籍信息
                Book cachedBook = bookService.getCachedBookInfo(finalBookUrl);

                String bookSourceUrl = null;

                // 优先从缓存的书籍信息中获取书源
                if (cachedBook != null && cachedBook.getOrigin() != null && !cachedBook.getOrigin().isEmpty()) {
                    bookSourceUrl = cachedBook.getOrigin();
                    bookInfo = cachedBook;
                }

                // 如果缓存中没有，尝试从请求中获取书源信息
                if (bookSourceUrl == null || bookSourceUrl.isEmpty()) {
                    if (body != null) {
                        if (body.get("bookSourceUrl") != null) {
                            bookSourceUrl = String.valueOf(body.get("bookSourceUrl"));
                        } else if (body.get("origin") != null) {
                            bookSourceUrl = String.valueOf(body.get("origin"));
                        } else if (body.get("searchBook") instanceof Map<?, ?>) {
                            Object origin = ((Map<?, ?>) body.get("searchBook")).get("origin");
                            if (origin != null) {
                                bookSourceUrl = String.valueOf(origin);
                            }
                        }
                    }
                }

                if (bookSourceUrl == null || bookSourceUrl.isEmpty()) {
                    return ReturnData.error("未配置书源");
                }

                bookSource = bookSourceService.getBookSourceByUrl(bookSourceUrl, finalUser);
                if (bookSource == null) {
                    return ReturnData.error("书源不存在");
                }

                // 如果缓存中没有书籍信息，通过书源获取
                if (bookInfo == null) {
                    bookInfo = webBookService.getBookInfo(bookSource, finalBookUrl);
                    if (bookInfo == null) {
                        return ReturnData.error("获取书籍信息失败");
                    }
                    // 缓存书籍信息
                    bookService.cacheBookInfo(bookInfo);
                }
            } else {
                // 书籍在书架上，获取对应书源
                if (!bookInfo.isLocalBook() && !"loc_book".equals(bookInfo.getOrigin())) {
                    bookSource = bookSourceService.getBookSourceByUrl(bookInfo.getOrigin(), finalUser);
                }
            }

            List<BookChapter> chapterList = null;

            // 如果书籍在书架上，先尝试从本地缓存获取章节列表
            if (isInShelf) {
                chapterList = bookService.getChapterList(finalBookUrl, finalUser);
            }

            // 如果需要刷新或章节列表为空，从网络获取
            if (finalRefresh > 0 || chapterList == null || chapterList.isEmpty()) {
                if (!bookInfo.isLocalBook() && !"loc_book".equals(bookInfo.getOrigin())) {
                    if (bookSource == null) {
                        return ReturnData.error("未配置书源");
                    }
                    chapterList = webBookService.getChapterList(bookSource, bookInfo);
                    if (chapterList != null) {
                        for (BookChapter ch : chapterList) {
                            if (ch != null) {
                                ch.setBookUrl(finalBookUrl);
                            }
                        }
                    }
                    // 只有在书架上的书籍才保存章节缓存
                    if (isInShelf && chapterList != null && !chapterList.isEmpty()) {
                        bookService.saveChapterList(finalBookUrl, chapterList, finalUser);
                    }
                }
            }

            if (chapterList == null) {
                chapterList = new ArrayList<>();
            }
            return ReturnData.success(chapterList);
        } catch (Exception e) {
            log.error("获取章节列表失败", e);
            return ReturnData.error("获取章节列表失败: " + e.getMessage());
        }
    }

    /**
     * 保存阅读进度
     */
    @PostMapping("/saveProgress")
    public ReturnData saveProgress(@RequestParam("bookUrl") String bookUrl,
            @RequestParam("chapterIndex") int chapterIndex,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (bookUrl == null || bookUrl.isEmpty()) {
                return ReturnData.error("书籍URL不能为空");
            }

            boolean success = bookService.saveProgress(bookUrl, chapterIndex, username);
            if (success) {
                return ReturnData.success("保存成功");
            } else {
                return ReturnData.error("保存失败");
            }
        } catch (Exception e) {
            log.error("保存阅读进度失败", e);
            return ReturnData.error("保存阅读进度失败: " + e.getMessage());
        }
    }

    /**
     * 保存阅读进度（兼容原项目接口名：saveBookProgress）
     * <p>
     * 兼容参数命名：
     * - 书籍链接：url / bookUrl / body.searchBook.bookUrl
     * - 章节索引：index / chapterIndex
     */
    @RequestMapping(value = "/saveBookProgress", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData saveBookProgress(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "index", required = false) Integer index,
            @RequestParam(value = "chapterIndex", required = false) Integer chapterIndex,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            // 优先使用 query 参数（GET/POST 都可能带 query），其次再从 body 里兜底
            String finalBookUrl = url != null && !url.isEmpty() ? url : bookUrl;
            Integer finalIndex = index != null ? index : chapterIndex;

            if ((finalBookUrl == null || finalBookUrl.isEmpty() || finalIndex == null) && body != null) {
                if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                    // 兼容前端 body: { url, index } 以及部分场景 body: { searchBook: { bookUrl } }
                    Object v = body.get("url");
                    if (v != null) {
                        finalBookUrl = String.valueOf(v);
                    } else if (body.get("bookUrl") != null) {
                        finalBookUrl = String.valueOf(body.get("bookUrl"));
                    } else if (body.get("searchBook") instanceof Map<?, ?>) {
                        Object inner = ((Map<?, ?>) body.get("searchBook")).get("bookUrl");
                        if (inner != null) {
                            finalBookUrl = String.valueOf(inner);
                        }
                    }
                }

                if (finalIndex == null && body.get("index") != null) {
                    // 兼容 body.index 为 number 或字符串
                    Object v = body.get("index");
                    if (v instanceof Number) {
                        finalIndex = ((Number) v).intValue();
                    } else {
                        try {
                            finalIndex = Integer.parseInt(String.valueOf(v));
                        } catch (Exception ignore) {
                            finalIndex = null;
                        }
                    }
                }
                if (finalIndex == null && body.get("chapterIndex") != null) {
                    // 兼容 body.chapterIndex 为 number 或字符串
                    Object v = body.get("chapterIndex");
                    if (v instanceof Number) {
                        finalIndex = ((Number) v).intValue();
                    } else {
                        try {
                            finalIndex = Integer.parseInt(String.valueOf(v));
                        } catch (Exception ignore) {
                            finalIndex = null;
                        }
                    }
                }
            }

            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("请输入书籍链接");
            }
            if (finalIndex == null || finalIndex < 0) {
                return ReturnData.error("请输入章节索引");
            }

            // BookService.saveProgress 仅对“已在书架”的书生效；未加入书架则返回 false
            boolean success = bookService.saveProgress(finalBookUrl, finalIndex, username);
            if (success) {
                return ReturnData.success("");
            }
            return ReturnData.error("书籍未加入书架");
        } catch (Exception e) {
            log.error("保存阅读进度失败", e);
            return ReturnData.error("保存阅读进度失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/searchBookContent", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData searchBookContent(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "lastIndex", required = false) Integer lastIndex,
            @RequestParam(value = "size", required = false) Integer size,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            String finalAccessToken = accessToken;
            if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null
                    && body.get("accessToken") != null) {
                finalAccessToken = String.valueOf(body.get("accessToken"));
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())
                    && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null
                    && !finalAccessToken.isEmpty()) {
                String[] parts = finalAccessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = url != null && !url.isEmpty() ? url : bookUrl;
            String finalKeyword = keyword;
            Integer finalLastIndex = lastIndex;
            Integer finalSize = size;

            if (body != null) {
                if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body.get("url") != null) {
                    finalBookUrl = String.valueOf(body.get("url"));
                }
                if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                }
                if ((finalKeyword == null || finalKeyword.isEmpty()) && body.get("keyword") != null) {
                    finalKeyword = String.valueOf(body.get("keyword"));
                }
                if (finalLastIndex == null && body.get("lastIndex") instanceof Number) {
                    finalLastIndex = ((Number) body.get("lastIndex")).intValue();
                }
                if (finalLastIndex == null && body.get("lastIndex") != null) {
                    try {
                        finalLastIndex = Integer.parseInt(String.valueOf(body.get("lastIndex")));
                    } catch (Exception ignore) {
                        finalLastIndex = null;
                    }
                }
                if (finalSize == null && body.get("size") instanceof Number) {
                    finalSize = ((Number) body.get("size")).intValue();
                }
                if (finalSize == null && body.get("size") != null) {
                    try {
                        finalSize = Integer.parseInt(String.valueOf(body.get("size")));
                    } catch (Exception ignore) {
                        finalSize = null;
                    }
                }
            }

            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("请输入书籍链接");
            }
            if (finalKeyword == null || finalKeyword.isEmpty()) {
                return ReturnData.error("请输入搜索关键词");
            }

            int startIndex = finalLastIndex == null ? 0 : finalLastIndex;
            int sizeLimit = finalSize == null || finalSize <= 0 ? 20 : finalSize;

            Book bookInfo = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            if (bookInfo == null) {
                return ReturnData.error("请先加入书架");
            }

            List<BookChapter> chapterList = bookService.getChapterList(finalBookUrl, finalUser);
            if (startIndex >= chapterList.size()) {
                return ReturnData.error("没有更多了");
            }

            List<Map<String, Object>> resultList = new ArrayList<>();
            int currentIndex = startIndex + 1;
            for (int pos = startIndex + 1; pos < chapterList.size(); pos++) {
                currentIndex = pos;
                BookChapter chapter = chapterList.get(pos);
                int chapterIndex = chapter != null && chapter.getIndex() != null ? chapter.getIndex() : pos;

                String chapterContent = bookService.getChapterContent(finalBookUrl, chapterIndex, finalUser);
                if (chapterContent == null || chapterContent.isEmpty()) {
                    continue;
                }

                List<Integer> positions = new ArrayList<>();
                int idx = chapterContent.indexOf(finalKeyword);
                while (idx >= 0) {
                    positions.add(idx);
                    idx = chapterContent.indexOf(finalKeyword, idx + 1);
                }
                if (positions.isEmpty()) {
                    continue;
                }

                String chapterTitle = chapter == null || chapter.getTitle() == null ? "" : chapter.getTitle();
                for (int i = 0; i < positions.size(); i++) {
                    int queryIndexInChapter = positions.get(i);
                    int left = Math.max(0, queryIndexInChapter - 20);
                    int right = Math.min(chapterContent.length(),
                            queryIndexInChapter + finalKeyword.length() + 20);
                    String resultText = chapterContent.substring(left, right);
                    int queryIndexInResult = queryIndexInChapter - left;

                    Map<String, Object> item = new HashMap<>();
                    item.put("resultCount", 0);
                    item.put("resultCountWithinChapter", i);
                    item.put("resultText", resultText);
                    item.put("chapterTitle", chapterTitle);
                    item.put("query", finalKeyword);
                    item.put("pageSize", 0);
                    item.put("chapterIndex", chapterIndex);
                    item.put("pageIndex", 0);
                    item.put("queryIndexInResult", queryIndexInResult);
                    item.put("queryIndexInChapter", queryIndexInChapter);
                    resultList.add(item);

                    if (resultList.size() >= sizeLimit) {
                        break;
                    }
                }

                if (resultList.size() >= sizeLimit) {
                    break;
                }
            }

            return ReturnData.success(Map.of("list", resultList, "lastIndex", currentIndex));
        } catch (Exception e) {
            log.error("搜索书籍内容失败", e);
            return ReturnData.error("搜索书籍内容失败: " + e.getMessage());
        }
    }

    /**
     * 搜索书籍
     */
    @GetMapping("/searchBook")
    public ReturnData searchBook(@RequestParam("key") String keyword,
            @RequestParam(value = "sourceUrl", required = false) String sourceUrl,
            @RequestParam(value = "page", defaultValue = "1") int page,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (keyword == null || keyword.isEmpty()) {
                return ReturnData.error("关键词不能为空");
            }

            // 调用搜索服务
            var result = bookService.searchBooks(keyword, sourceUrl, page, username);
            return ReturnData.success(result);
        } catch (Exception e) {
            log.error("搜索书籍失败", e);
            return ReturnData.error("搜索书籍失败: " + e.getMessage());
        }
    }

    /**
     * 发现书籍 (探索)
     */
    @RequestMapping(value = "/exploreBook", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData exploreBook(@RequestParam(value = "ruleFindUrl", required = false) String ruleFindUrl,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "page", defaultValue = "1") int page,
            @RequestParam(value = "bookSourceUrl", required = false) String sourceUrl,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            String finalUrl = ruleFindUrl;
            int finalPage = page;

            if (body != null) {
                if (body.containsKey("ruleFindUrl")) {
                    finalUrl = (String) body.get("ruleFindUrl");
                }
                if (body.containsKey("page")) {
                    finalPage = (Integer) body.get("page");
                }
            }

            if (finalUrl == null || finalUrl.isEmpty()) {
                return ReturnData.error("链接不能为空");
            }

            // 获取书源URL，如果参数中没有，尝试从body获取 (适配不同前端调用方式)
            String finalSourceUrl = sourceUrl;
            if (finalSourceUrl == null && body != null && body.containsKey("bookSourceUrl")) {
                finalSourceUrl = (String) body.get("bookSourceUrl");
            }

            // 如果还是没有sourceUrl，可能在accessToken里或者其他地方，但通常发现请求会带sourceUrl
            // 在Legado中，如果是发现页面，通常会先选择书源

            var result = bookService.exploreBooks(finalUrl, finalPage, finalSourceUrl, username);
            return ReturnData.success(result);
        } catch (Exception e) {
            log.error("发现书籍失败", e);
            return ReturnData.error("发现书籍失败: " + e.getMessage());
        }
    }

    /**
     * 获取书籍信息
     */
    @GetMapping("/getBookInfo")
    public ReturnData getBookInfo(@RequestParam("bookUrl") String bookUrl,
            @RequestParam(value = "sourceUrl", required = false) String sourceUrl,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (bookUrl == null || bookUrl.isEmpty()) {
                return ReturnData.error("书籍URL不能为空");
            }

            Book book = bookService.getBookInfo(bookUrl, sourceUrl, username);
            if (book != null) {
                return ReturnData.success(book);
            } else {
                return ReturnData.error("获取书籍信息失败");
            }
        } catch (Exception e) {
            log.error("获取书籍信息失败", e);
            return ReturnData.error("获取书籍信息失败: " + e.getMessage());
        }
    }

    /**
     * 获取章节内容
     */
    @RequestMapping(value = "/getBookContent",method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getBookContent(@RequestParam(value = "url", required = false) String url,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "index", required = false) Integer index,
            @RequestParam(value = "chapterIndex", required = false) Integer chapterIndex,
            @RequestParam(value = "refresh", required = false) Integer refresh,
            @RequestParam(value = "cache", required = false) Integer cache,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            String finalAccessToken = accessToken;
            if ((finalAccessToken == null || finalAccessToken.isEmpty()) && body != null
                    && body.get("accessToken") != null) {
                finalAccessToken = String.valueOf(body.get("accessToken"));
            }

            if (Boolean.TRUE.equals(readerConfig.getSecure())
                    && (finalAccessToken == null || finalAccessToken.isEmpty())) {
                return new ReturnData(false, "请登录后使用", "NEED_LOGIN");
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : null;
            if ((finalUser == null || finalUser.isEmpty()) && finalAccessToken != null
                    && !finalAccessToken.isEmpty()) {
                String[] parts = finalAccessToken.split(":", 2);
                if (parts.length >= 1 && !parts[0].isEmpty()) {
                    finalUser = parts[0];
                }
            }
            if (finalUser == null || finalUser.isEmpty()) {
                finalUser = "default";
            }

            String finalBookUrl = (url != null && !url.isEmpty()) ? url : bookUrl;
            if ((finalBookUrl == null || finalBookUrl.isEmpty()) && body != null) {
                Object v = body.get("url");
                if (v != null) {
                    finalBookUrl = String.valueOf(v);
                } else if (body.get("bookUrl") != null) {
                    finalBookUrl = String.valueOf(body.get("bookUrl"));
                }
            }
            if (finalBookUrl == null || finalBookUrl.isEmpty()) {
                return ReturnData.error("书籍URL不能为空");
            }

            Integer finalChapterIndex = chapterIndex != null ? chapterIndex : index;
            if (finalChapterIndex == null && body != null) {
                Object v = body.get("chapterIndex");
                if (v == null) {
                    v = body.get("index");
                }
                if (v instanceof Number) {
                    finalChapterIndex = ((Number) v).intValue();
                } else if (v != null) {
                    try {
                        finalChapterIndex = Integer.parseInt(String.valueOf(v));
                    } catch (Exception ignore) {
                        finalChapterIndex = null;
                    }
                }
            }
            if (finalChapterIndex == null) {
                return ReturnData.error("章节索引不能为空");
            }

            boolean refreshFlag = false;
            if (refresh != null && refresh > 0) {
                refreshFlag = true;
            } else if (body != null && body.get("refresh") != null) {
                Object v = body.get("refresh");
                if (v instanceof Number) {
                    refreshFlag = ((Number) v).intValue() > 0;
                } else {
                    try {
                        refreshFlag = Integer.parseInt(String.valueOf(v)) > 0;
                    } catch (Exception ignore) {
                        refreshFlag = false;
                    }
                }
            }

            // 检查书籍是否在书架上
            Book bookInfo = bookService.getShelfBookByURL(finalBookUrl, finalUser);
            BookSource bookSource = null;
            boolean isInShelf = (bookInfo != null);

            if (bookInfo == null) {
                // 书籍未加入书架，尝试从缓存获取书籍信息
                Book cachedBook = bookService.getCachedBookInfo(finalBookUrl);

                String bookSourceUrl = null;

                // 优先从缓存的书籍信息中获取书源
                if (cachedBook != null && cachedBook.getOrigin() != null && !cachedBook.getOrigin().isEmpty()) {
                    bookSourceUrl = cachedBook.getOrigin();
                    bookInfo = cachedBook;
                }

                // 如果缓存中没有，尝试从请求中获取书源信息
                if (bookSourceUrl == null || bookSourceUrl.isEmpty()) {
                    if (body != null) {
                        if (body.get("bookSourceUrl") != null) {
                            bookSourceUrl = String.valueOf(body.get("bookSourceUrl"));
                        } else if (body.get("origin") != null) {
                            bookSourceUrl = String.valueOf(body.get("origin"));
                        } else if (body.get("searchBook") instanceof Map<?, ?>) {
                            Object origin = ((Map<?, ?>) body.get("searchBook")).get("origin");
                            if (origin != null) {
                                bookSourceUrl = String.valueOf(origin);
                            }
                        }
                    }
                }

                if (bookSourceUrl == null || bookSourceUrl.isEmpty()) {
                    return ReturnData.error("未配置书源");
                }

                bookSource = bookSourceService.getBookSourceByUrl(bookSourceUrl, finalUser);
                if (bookSource == null) {
                    return ReturnData.error("书源不存在");
                }

                // 如果缓存中没有书籍信息，通过书源获取
                if (bookInfo == null) {
                    bookInfo = webBookService.getBookInfo(bookSource, finalBookUrl);
                    if (bookInfo == null) {
                        return ReturnData.error("获取书籍信息失败");
                    }
                    // 缓存书籍信息
                    bookService.cacheBookInfo(bookInfo);
                }
            } else {
                // 书籍在书架上，获取对应书源
                if (!bookInfo.isLocalBook() && !"loc_book".equals(bookInfo.getOrigin())) {
                    bookSource = bookSourceService.getBookSourceByUrl(bookInfo.getOrigin(), finalUser);
                }
            }

            if (!bookInfo.isLocalBook() && bookSource == null) {
                return ReturnData.error("未配置书源");
            }

            // 获取章节列表
            List<BookChapter> chapterList = null;
            if (isInShelf) {
                chapterList = bookService.getChapterList(finalBookUrl, finalUser);
            }
            if (chapterList == null || chapterList.isEmpty()) {
                if (bookSource != null) {
                    chapterList = webBookService.getChapterList(bookSource, bookInfo);
                    if (chapterList != null) {
                        for (BookChapter ch : chapterList) {
                            if (ch != null) {
                                ch.setBookUrl(finalBookUrl);
                            }
                        }
                    }
                }
            }

            if (chapterList == null || chapterList.isEmpty()) {
                return ReturnData.error("获取章节列表失败");
            }

            if (finalChapterIndex < 0 || finalChapterIndex >= chapterList.size()) {
                return ReturnData.error("章节索引超出范围");
            }

            BookChapter chapter = chapterList.get(finalChapterIndex);
            if (chapter == null || chapter.getUrl() == null || chapter.getUrl().isEmpty()) {
                return ReturnData.error("获取章节信息失败");
            }

            // 如果在书架上，先尝试从缓存获取
            String content = null;
            if (isInShelf && !refreshFlag) {
                content = bookService.getCachedContent(finalBookUrl, finalChapterIndex, finalUser);
            }

            // 从网络获取章节内容
            if (content == null || content.isEmpty()) {
                content = webBookService.getChapterContent(bookSource, chapter);
                // 只有在书架上的书籍才保存缓存
                if (isInShelf && content != null && !content.isEmpty()) {
                    bookService.saveChapterContent(finalBookUrl, finalChapterIndex, content, finalUser);
                }
            }

            if (content == null) {
                content = "";
            }
            return ReturnData.success(content);
        } catch (Exception e) {
            log.error("获取章节内容失败", e);
            return ReturnData.error("获取章节内容失败: " + e.getMessage());
        }
    }

    /**
     * 刷新章节列表
     */
    @PostMapping("/refreshChapterList")
    public ReturnData refreshChapterList(@RequestParam("bookUrl") String bookUrl,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (bookUrl == null || bookUrl.isEmpty()) {
                return ReturnData.error("书籍URL不能为空");
            }

            List<BookChapter> chapters = bookService.refreshChapterList(bookUrl, username);
            return ReturnData.success(chapters);
        } catch (Exception e) {
            log.error("刷新章节列表失败", e);
            return ReturnData.error("刷新章节列表失败: " + e.getMessage());
        }
    }
}
