package com.htmake.reader.controller;

import com.htmake.reader.entity.ReplaceRule;
import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.service.ReplaceRuleService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 替换规则Controller
 */
@Slf4j
@RestController
@RequestMapping("/reader3")
public class ReplaceRuleController {

    @Autowired
    private ReplaceRuleService replaceRuleService;

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
     * 获取所有替换规则
     */
    @GetMapping("/getReplaceRules")
    public ReturnData getReplaceRules(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            List<ReplaceRule> rules = replaceRuleService.getAllRules(finalUsername);
            return ReturnData.success(rules);
        } catch (Exception e) {
            log.error("获取替换规则失败", e);
            return ReturnData.error("获取替换规则失败: " + e.getMessage());
        }
    }

    /**
     * 保存替换规则
     */
    @PostMapping("/saveReplaceRule")
    public ReturnData saveReplaceRule(@RequestBody ReplaceRule rule,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = replaceRuleService.saveRule(rule, finalUsername);
            if (success) {
                return ReturnData.success(rule);
            } else {
                return ReturnData.error("保存替换规则失败");
            }
        } catch (Exception e) {
            log.error("保存替换规则失败", e);
            return ReturnData.error("保存替换规则失败: " + e.getMessage());
        }
    }

    /**
     * 删除替换规则
     */
    @PostMapping("/deleteReplaceRule")
    public ReturnData deleteReplaceRule(@RequestParam("ruleId") Long ruleId,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = replaceRuleService.deleteRule(ruleId, finalUsername);
            if (success) {
                return ReturnData.success("删除成功");
            } else {
                return ReturnData.error("删除失败");
            }
        } catch (Exception e) {
            log.error("删除替换规则失败", e);
            return ReturnData.error("删除替换规则失败: " + e.getMessage());
        }
    }
}
