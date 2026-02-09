package com.htmake.reader.controller;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.htmake.reader.entity.BookSource;
import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.service.BookSourceService;
import com.htmake.reader.utils.StorageHelper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.io.File;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 书源管理Controller
 */
@Slf4j
@RestController
@RequestMapping("/reader3")
public class BookSourceController {

    private static final Gson GSON = new Gson();

    @Autowired
    private BookSourceService bookSourceService;

    @Autowired
    private StorageHelper storageHelper;

    /**
     * 从请求中获取用户名（参考 BookController.getBookshelf 方法）
     * 优先级：1. session  2. accessToken  3. username 参数
     */
    private String getUsernameFromRequest(HttpServletRequest request, String username, String accessToken) {
        // 第一优先级：从 session 中获取用户名
        HttpSession session = request.getSession(false);
        if (session != null) {
            Object sessionUser = session.getAttribute("username");
            if (sessionUser != null && !sessionUser.toString().isEmpty()) {
                return sessionUser.toString();
            }
        }

        // 第二优先级：从 accessToken 参数中解析用户名
        if (accessToken != null && !accessToken.isEmpty()) {
            String[] parts = accessToken.split(":", 2);
            if (parts.length >= 1 && !parts[0].isEmpty()) {
                return parts[0];
            }
        }

        // 第三优先级：使用 username 参数
        if (username != null && !username.isEmpty()) {
            return username;
        }

        // 默认使用 "default" 用户
        return "default";
    }

    /**
     * 获取所有书源
     */
    @RequestMapping(value = "/getBookSources", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getBookSources(@RequestParam(value = "simple", required = false) Integer simple,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            // 从 session/accessToken/username 获取当前用户
            String finalUsername = getUsernameFromRequest(request, username, accessToken);

            int finalSimple = simple != null ? simple : 0;
            if (body != null && body.get("simple") != null) {
                Object v = body.get("simple");
                if (v instanceof Number) {
                    finalSimple = ((Number) v).intValue();
                } else {
                    try {
                        finalSimple = Integer.parseInt(String.valueOf(v));
                    } catch (Exception ignore) {
                        finalSimple = 0;
                    }
                }
            }

            List<BookSource> sources = bookSourceService.getAllBookSources(finalUsername);
            if (finalSimple > 0) {
                List<Map<String, Object>> list = new ArrayList<>();
                for (BookSource source : sources) {
                    Map<String, Object> item = new HashMap<>();
                    item.put("bookSourceGroup", source.getBookSourceGroup());
                    item.put("bookSourceName", source.getBookSourceName());
                    item.put("bookSourceUrl", source.getBookSourceUrl());
                    item.put("exploreUrl", source.getExploreUrl());
                    list.add(item);
                }
                return ReturnData.success(list);
            }

            return ReturnData.success(sources);
        } catch (Exception e) {
            log.error("获取书源列表失败", e);
            return ReturnData.error("获取书源列表失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getBookSource", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getBookSource(@RequestParam(value = "bookSourceUrl", required = false) String bookSourceUrl,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            // 从 session/accessToken/username 获取当前用户
            String finalUsername = getUsernameFromRequest(request, username, accessToken);

            String finalUrl = bookSourceUrl;
            if ((finalUrl == null || finalUrl.isEmpty()) && body != null && body.get("bookSourceUrl") != null) {
                finalUrl = String.valueOf(body.get("bookSourceUrl"));
            }

            if (finalUrl == null || finalUrl.isEmpty()) {
                return ReturnData.error("书源链接不能为空");
            }

            BookSource source = bookSourceService.getBookSourceByUrl(finalUrl, finalUsername);
            if (source == null) {
                return ReturnData.error("书源信息不存在");
            }

            return ReturnData.success(source);
        } catch (Exception e) {
            log.error("获取书源失败", e);
            return ReturnData.error("获取书源失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getInvalidBookSources", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getInvalidBookSources(@RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            return ReturnData.success(bookSourceService.getInvalidBookSources(username));
        } catch (Exception e) {
            log.error("获取失效书源失败", e);
            return ReturnData.error("获取失效书源失败: " + e.getMessage());
        }
    }

    @RequestMapping(value = "/getRssSources", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getRssSources(@RequestParam(value = "simple", required = false) Integer simple,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "userNS", required = false) String userNS) {
        try {
            int finalSimple = simple != null ? simple : 0;
            if (body != null && body.get("simple") != null) {
                Object v = body.get("simple");
                if (v instanceof Number) {
                    finalSimple = ((Number) v).intValue();
                } else {
                    try {
                        finalSimple = Integer.parseInt(String.valueOf(v));
                    } catch (Exception ignore) {
                        finalSimple = 0;
                    }
                }
            }

            String finalUser = (userNS != null && !userNS.isEmpty()) ? userNS
                    : (username != null && !username.isEmpty()) ? username : "default";

            String rssSourcePath = storageHelper.getUserDataPath(finalUser) + File.separator + "rssSources.json";
            File rssSourceFile = new File(rssSourcePath);
            if (!rssSourceFile.exists()) {
                return ReturnData.success(new ArrayList<>());
            }

            String json = storageHelper.readFile(rssSourcePath);
            if (json == null || json.isEmpty()) {
                return ReturnData.success(new ArrayList<>());
            }

            Type listType = new TypeToken<List<Map<String, Object>>>() {
            }.getType();
            List<Map<String, Object>> sources = GSON.fromJson(json, listType);
            if (sources == null) {
                sources = new ArrayList<>();
            }

            if (finalSimple > 0) {
                return ReturnData.success(sources);
            }
            return ReturnData.success(sources);
        } catch (Exception e) {
            log.error("获取RSS源列表失败", e);
            return ReturnData.error("获取RSS源列表失败: " + e.getMessage());
        }
    }

    /**
     * 获取启用的书源
     */
    @GetMapping("/getEnabledBookSources")
    public ReturnData getEnabledBookSources(
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            List<BookSource> sources = bookSourceService.getEnabledBookSources(username);
            return ReturnData.success(sources);
        } catch (Exception e) {
            log.error("获取启用书源失败", e);
            return ReturnData.error("获取启用书源失败: " + e.getMessage());
        }
    }

    /**
     * 保存书源
     */
    @PostMapping("/saveBookSource")
    public ReturnData saveBookSource(@RequestBody BookSource bookSource,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (bookSource == null || bookSource.getBookSourceUrl() == null
                    || bookSource.getBookSourceUrl().isEmpty()) {
                return ReturnData.error("书源信息不完整");
            }

            boolean success = bookSourceService.saveBookSource(bookSource, username);
            if (success) {
                return ReturnData.success(bookSource);
            } else {
                return ReturnData.error("保存书源失败");
            }
        } catch (Exception e) {
            log.error("保存书源失败", e);
            return ReturnData.error("保存书源失败: " + e.getMessage());
        }
    }

    /**
     * 批量保存书源
     */
    @PostMapping("/saveBookSources")
    public ReturnData saveBookSources(@RequestBody List<BookSource> bookSources,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (bookSources == null || bookSources.isEmpty()) {
                return ReturnData.error("书源列表不能为空");
            }

            boolean success = bookSourceService.saveBookSources(bookSources, username);
            if (success) {
                return ReturnData.success("保存成功");
            } else {
                return ReturnData.error("保存书源失败");
            }
        } catch (Exception e) {
            log.error("批量保存书源失败", e);
            return ReturnData.error("批量保存书源失败: " + e.getMessage());
        }
    }

    /**
     * 删除书源
     */
    @PostMapping("/deleteBookSource")
    public ReturnData deleteBookSource(@RequestParam("sourceUrl") String sourceUrl,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (sourceUrl == null || sourceUrl.isEmpty()) {
                return ReturnData.error("书源URL不能为空");
            }

            boolean success = bookSourceService.deleteBookSource(sourceUrl, username);
            if (success) {
                return ReturnData.success("删除成功");
            } else {
                return ReturnData.error("删除失败");
            }
        } catch (Exception e) {
            log.error("删除书源失败", e);
            return ReturnData.error("删除书源失败: " + e.getMessage());
        }
    }

    /**
     * 批量删除书源
     */
    @PostMapping("/deleteBookSources")
    public ReturnData deleteBookSources(@RequestBody List<String> sourceUrls,
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            if (sourceUrls == null || sourceUrls.isEmpty()) {
                return ReturnData.error("书源URL列表不能为空");
            }

            boolean success = bookSourceService.deleteBookSources(sourceUrls, username);
            if (success) {
                return ReturnData.success("删除成功");
            } else {
                return ReturnData.error("删除失败");
            }
        } catch (Exception e) {
            log.error("批量删除书源失败", e);
            return ReturnData.error("批量删除书源失败: " + e.getMessage());
        }
    }

    /**
     * 删除所有书源
     */
    @PostMapping("/deleteAllBookSources")
    public ReturnData deleteAllBookSources(
            @RequestParam(value = "username", defaultValue = "default") String username) {
        try {
            boolean success = bookSourceService.deleteAllBookSources(username);
            if (success) {
                return ReturnData.success("删除成功");
            } else {
                return ReturnData.error("删除失败");
            }
        } catch (Exception e) {
            log.error("删除所有书源失败", e);
            return ReturnData.error("删除所有书源失败: " + e.getMessage());
        }
    }
}
