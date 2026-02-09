package com.htmake.reader.controller;

import com.htmake.reader.entity.Bookmark;
import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.service.BookmarkService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 书签Controller
 */
@Slf4j
@RestController
@RequestMapping("/reader3")
public class BookmarkController {

    @Autowired
    private BookmarkService bookmarkService;

    /**
     * 从请求中获取用户名（参考 BookSourceController）
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
     * 获取所有书签
     */
    @GetMapping("/getBookmarks")
    public ReturnData getBookmarks(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "bookUrl", required = false) String bookUrl,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            List<Bookmark> bookmarks;
            if (bookUrl != null && !bookUrl.isEmpty()) {
                bookmarks = bookmarkService.getBookmarksByBook(bookUrl, finalUsername);
            } else {
                bookmarks = bookmarkService.getAllBookmarks(finalUsername);
            }
            return ReturnData.success(bookmarks);
        } catch (Exception e) {
            log.error("获取书签失败", e);
            return ReturnData.error("获取书签失败: " + e.getMessage());
        }
    }

    /**
     * 保存书签
     */
    @PostMapping("/saveBookmark")
    public ReturnData saveBookmark(@RequestBody Bookmark bookmark,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = bookmarkService.saveBookmark(bookmark, finalUsername);
            if (success) {
                return ReturnData.success(bookmark);
            } else {
                return ReturnData.error("保存书签失败");
            }
        } catch (Exception e) {
            log.error("保存书签失败", e);
            return ReturnData.error("保存书签失败: " + e.getMessage());
        }
    }

    /**
     * 删除书签
     */
    @PostMapping("/deleteBookmark")
    public ReturnData deleteBookmark(@RequestParam("bookmarkId") Long bookmarkId,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = bookmarkService.deleteBookmark(bookmarkId, finalUsername);
            if (success) {
                return ReturnData.success("删除成功");
            } else {
                return ReturnData.error("删除失败");
            }
        } catch (Exception e) {
            log.error("删除书签失败", e);
            return ReturnData.error("删除书签失败: " + e.getMessage());
        }
    }
}
