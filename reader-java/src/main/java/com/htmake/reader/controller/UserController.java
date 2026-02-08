package com.htmake.reader.controller;

import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.entity.User;
import com.htmake.reader.service.UserService;
import com.htmake.reader.config.ReaderConfig;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 用户管理Controller
 */
@Slf4j
@RestController
@RequestMapping("/reader3")
public class UserController {

    /** 登录 token 过期天数 */
    private static final int LOGIN_EXPIRE_DAYS = 7;

    @Autowired
    private UserService userService;

    @Autowired
    private ReaderConfig readerConfig;

    /**
     * 用户登录/注册
     * 通过 isLogin 参数区分：
     * - isLogin = true: 登录模式
     * - isLogin = false: 注册模式
     */
    @PostMapping("/login")
    public ReturnData login(@RequestBody Map<String, Object> loginData) {
        try {
            String username = loginData.get("username") != null ? String.valueOf(loginData.get("username")) : "";
            String password = loginData.get("password") != null ? String.valueOf(loginData.get("password")) : "";
            Boolean isLogin = loginData.get("isLogin") != null
                    ? Boolean.valueOf(String.valueOf(loginData.get("isLogin")))
                    : false;
            String code = loginData.get("code") != null ? String.valueOf(loginData.get("code")) : "";

            if (username.isEmpty()) {
                return ReturnData.error("请输入用户名");
            }
            if (password.isEmpty()) {
                return ReturnData.error("请输入密码");
            }

            // 检查用户是否存在
            User existedUser = userService.getUserByUsername(username);

            if (existedUser == null) {
                // 用户不存在
                if (isLogin) {
                    // 登录模式：返回用户不存在
                    return ReturnData.error("用户不存在");
                }

                // 注册模式：创建新用户
                if (username.length() < 5) {
                    return ReturnData.error("用户名不能低于5位");
                }
                if (password.length() < 8) {
                    return ReturnData.error("密码不能低于8位");
                }
                if ("default".equals(username)) {
                    return ReturnData.error("用户名不能为非法字符");
                }
                // 用户名只能由字母和数字组成
                if (!username.matches("[a-zA-Z0-9]+")) {
                    return ReturnData.error("用户名只能由字母和数字组成");
                }

                // 检查邀请码
                String inviteCode = readerConfig.getInviteCode();
                if (inviteCode != null && !inviteCode.isEmpty()) {
                    if (code.isEmpty()) {
                        return ReturnData.error("请输入邀请码");
                    }
                    if (!inviteCode.equals(code)) {
                        return ReturnData.error("邀请码错误");
                    }
                }

                // 检查用户数量限制
                int userLimit = readerConfig.getUserLimit() != null ? readerConfig.getUserLimit() : 50;
                userLimit = Math.min(Math.max(userLimit, 1), 50);
                if (userService.getUserCount() >= userLimit) {
                    return ReturnData.error("超过用户数上限");
                }

                // 注册新用户
                boolean success = userService.register(username, password);
                if (!success) {
                    return ReturnData.error("注册失败");
                }

                // 获取新注册的用户并返回
                User newUser = userService.getUserByUsername(username);
                return ReturnData.success(buildUserResult(newUser));
            } else {
                // 用户已存在
                if (!isLogin) {
                    // 注册模式：返回用户名已被占用
                    return ReturnData.error("用户名已被占用");
                }

                // 登录模式：验证密码
                User user = userService.login(username, password);
                if (user == null) {
                    return ReturnData.error("密码错误");
                }

                return ReturnData.success(buildUserResult(user));
            }
        } catch (Exception e) {
            log.error("用户登录/注册失败", e);
            return ReturnData.error("操作失败: " + e.getMessage());
        }
    }

    /**
     * 生成加密 token（参考 Kotlin 源版 genEncryptedPassword）
     */
    private String genEncryptedToken(String username, String salt) {
        String firstMd5 = com.htmake.reader.utils.MD5Utils.md5Encode(username + salt);
        return com.htmake.reader.utils.MD5Utils.md5Encode(firstMd5 + salt);
    }

    /**
     * 构建用户返回结果（生成并保存 token）
     */
    private Map<String, Object> buildUserResult(User user) {
        Map<String, Object> result = new HashMap<>();
        if (user != null) {
            // 生成加密 token
            String timestamp = String.valueOf(System.currentTimeMillis());
            String token = genEncryptedToken(user.getUsername(), timestamp);
            long expireTime = System.currentTimeMillis() + LOGIN_EXPIRE_DAYS * 86400L * 1000L;

            // 更新用户 token
            user.setToken(token);
            user.setLastLoginTime(System.currentTimeMillis());

            // 更新 tokenMap
            java.util.Map<String, Long> tokenMap = user.getTokenMap();
            if (tokenMap == null) {
                tokenMap = new HashMap<>();
            }
            tokenMap.put(token, expireTime);
            // 清理过期 token
            long now = System.currentTimeMillis();
            tokenMap.entrySet().removeIf(entry -> entry.getValue() < now);
            user.setTokenMap(tokenMap);

            // 保存用户
            userService.saveUser(user);

            result.put("username", user.getUsername());
            result.put("accessToken", user.getUsername() + ":" + token);
            result.put("isAdmin", user.getIsAdmin());
            result.put("enableWebdav", user.getEnableWebdav());
            result.put("enableLocalStore", user.getEnableLocalStore());
            result.put("enableBookSource", user.getEnableBookSource());
            result.put("enableRssSource", user.getEnableRssSource());
        }
        return result;
    }

    /**
     * 注销登录（兼容原项目接口名：logout）
     * <p>
     * 当前 Java 版本未实现基于 Session 的登录态，前端仅依赖该接口返回 isSuccess=true 后清理本地 token。
     */
    @RequestMapping(value = "/logout", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData logout() {
        return ReturnData.success("");
    }

    /**
     * 用户注册
     */
    @PostMapping("/register")
    public ReturnData register(@RequestBody Map<String, String> registerData) {
        try {
            String username = registerData.get("username");
            String password = registerData.get("password");

            if (username == null || username.isEmpty()) {
                return ReturnData.error("用户名不能为空");
            }
            if (password == null || password.isEmpty()) {
                return ReturnData.error("密码不能为空");
            }

            // 用户名长度验证
            if (username.length() < 3 || username.length() > 20) {
                return ReturnData.error("用户名长度必须在3-20个字符之间");
            }

            // 密码长度验证
            if (password.length() < 6) {
                return ReturnData.error("密码长度不能少于6个字符");
            }

            boolean success = userService.register(username, password);
            if (success) {
                return ReturnData.success("注册成功");
            } else {
                return ReturnData.error("注册失败，用户名可能已存在或已达到用户数量限制");
            }
        } catch (Exception e) {
            log.error("用户注册失败", e);
            return ReturnData.error("注册失败: " + e.getMessage());
        }
    }

    /**
     * 获取用户信息
     * <p>
     * 返回结构与前端保持一致：data 中包含 userInfo、secure、secureKey。
     * userInfo 为空表示当前未登录或无法识别用户。
     */
    @RequestMapping(value = "/getUserInfo", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getUserInfo(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken) {
        try {
            Map<String, Object> result = new HashMap<>();
            result.put("secure", readerConfig.getSecure());
            result.put("secureKey", readerConfig.getSecureKey() != null && !readerConfig.getSecureKey().isEmpty());

            // 解析 accessToken
            String finalUsername = username;
            String token = null;
            if (accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 2) {
                    finalUsername = parts[0];
                    token = parts[1];
                } else if (parts.length == 1) {
                    finalUsername = parts[0];
                }
            }

            if (finalUsername == null || finalUsername.isEmpty()) {
                result.put("userInfo", null);
                return ReturnData.success(result);
            }

            User user = userService.getUserByUsername(finalUsername);
            if (user == null) {
                result.put("userInfo", null);
                return ReturnData.success(result);
            }

            // 验证 token 有效性
            boolean isValidToken = false;
            if (token != null && !token.isEmpty()) {
                // 检查是否与当前 token 匹配
                if (token.equals(user.getToken())) {
                    isValidToken = true;
                }
                // 检查历史 tokenMap
                if (!isValidToken && user.getTokenMap() != null) {
                    Long expireTime = user.getTokenMap().get(token);
                    if (expireTime != null && expireTime > System.currentTimeMillis()) {
                        isValidToken = true;
                        // 延长 token 有效期
                        user.getTokenMap().put(token, System.currentTimeMillis() + LOGIN_EXPIRE_DAYS * 86400L * 1000L);
                        userService.saveUser(user);
                    }
                }
            }

            // 如果启用了安全模式且 token 无效，返回空 userInfo
            if (readerConfig.getSecure() != null && readerConfig.getSecure() && !isValidToken) {
                result.put("userInfo", null);
                return ReturnData.success(result);
            }

            Map<String, Object> userInfo = new HashMap<>();
            userInfo.put("username", user.getUsername());
            userInfo.put("isAdmin", user.getIsAdmin());
            userInfo.put("enableWebdav", user.getEnableWebdav());
            userInfo.put("enableLocalStore", user.getEnableLocalStore());
            userInfo.put("enableBookSource", user.getEnableBookSource());
            userInfo.put("enableRssSource", user.getEnableRssSource());
            userInfo.put("bookSourceLimit", user.getBookSourceLimit());
            userInfo.put("bookLimit", user.getBookLimit());
            userInfo.put("createTime", user.getCreateTime());
            userInfo.put("lastLoginTime", user.getLastLoginTime());
            result.put("userInfo", userInfo);

            return ReturnData.success(result);
        } catch (Exception e) {
            log.error("获取用户信息失败", e);
            return ReturnData.error("获取用户信息失败: " + e.getMessage());
        }
    }

    /**
     * 获取所有用户（仅管理员）
     */
    @GetMapping("/getAllUsers")
    public ReturnData getAllUsers() {
        try {
            List<User> users = userService.getAllUsers();

            // 移除密码信息
            users.forEach(user -> user.setPassword(null));

            return ReturnData.success(users);
        } catch (Exception e) {
            log.error("获取用户列表失败", e);
            return ReturnData.error("获取用户列表失败: " + e.getMessage());
        }
    }

    /**
     * 更新用户信息
     */
    @PostMapping("/updateUser")
    public ReturnData updateUser(@RequestBody User user) {
        try {
            if (user == null || user.getUsername() == null || user.getUsername().isEmpty()) {
                return ReturnData.error("用户信息不完整");
            }

            // 获取现有用户
            User existingUser = userService.getUserByUsername(user.getUsername());
            if (existingUser == null) {
                return ReturnData.error("用户不存在");
            }

            // 只更新允许修改的字段
            if (user.getEnableWebdav() != null) {
                existingUser.setEnableWebdav(user.getEnableWebdav());
            }
            if (user.getEnableLocalStore() != null) {
                existingUser.setEnableLocalStore(user.getEnableLocalStore());
            }
            if (user.getEnableBookSource() != null) {
                existingUser.setEnableBookSource(user.getEnableBookSource());
            }
            if (user.getEnableRssSource() != null) {
                existingUser.setEnableRssSource(user.getEnableRssSource());
            }

            boolean success = userService.saveUser(existingUser);
            if (success) {
                return ReturnData.success("更新成功");
            } else {
                return ReturnData.error("更新失败");
            }
        } catch (Exception e) {
            log.error("更新用户信息失败", e);
            return ReturnData.error("更新用户信息失败: " + e.getMessage());
        }
    }

    /**
     * 修改密码
     */
    @PostMapping("/changePassword")
    public ReturnData changePassword(@RequestBody Map<String, String> passwordData) {
        try {
            String username = passwordData.get("username");
            String oldPassword = passwordData.get("oldPassword");
            String newPassword = passwordData.get("newPassword");

            if (username == null || username.isEmpty()) {
                return ReturnData.error("用户名不能为空");
            }
            if (oldPassword == null || oldPassword.isEmpty()) {
                return ReturnData.error("旧密码不能为空");
            }
            if (newPassword == null || newPassword.isEmpty()) {
                return ReturnData.error("新密码不能为空");
            }
            if (newPassword.length() < 6) {
                return ReturnData.error("新密码长度不能少于6个字符");
            }

            // 验证旧密码
            User user = userService.login(username, oldPassword);
            if (user == null) {
                return ReturnData.error("旧密码错误");
            }

            // 更新密码
            user.setPassword(com.htmake.reader.utils.MD5Utils.md5Encode(newPassword));
            boolean success = userService.saveUser(user);

            if (success) {
                return ReturnData.success("密码修改成功");
            } else {
                return ReturnData.error("密码修改失败");
            }
        } catch (Exception e) {
            log.error("修改密码失败", e);
            return ReturnData.error("修改密码失败: " + e.getMessage());
        }
    }

    @org.springframework.beans.factory.annotation.Autowired
    private com.htmake.reader.utils.StorageHelper storageHelper;

    /**
     * 获取用户命名空间（用于存储隔离）
     */
    private String getUserNameSpace(String accessToken) {
        if (readerConfig.getSecure() == null || !readerConfig.getSecure()) {
            return "default";
        }
        if (accessToken != null && !accessToken.isEmpty()) {
            String[] parts = accessToken.split(":", 2);
            if (parts.length >= 1 && !parts[0].isEmpty()) {
                return parts[0];
            }
        }
        return "default";
    }

    /**
     * 保存用户配置
     */
    @PostMapping("/saveUserConfig")
    public ReturnData saveUserConfig(@RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestBody Map<String, Object> config) {
        try {
            String userNameSpace = getUserNameSpace(accessToken);

            // 添加更新时间
            config.put("@updateTime", System.currentTimeMillis());

            // 保存到用户目录
            String configPath = storageHelper.getUserDataPath(userNameSpace) + java.io.File.separator
                    + "userConfig.json";
            String json = new com.google.gson.Gson().toJson(config);
            boolean success = storageHelper.writeFile(configPath, json);

            if (success) {
                return ReturnData.success("");
            } else {
                return ReturnData.error("保存配置失败");
            }
        } catch (Exception e) {
            log.error("保存用户配置失败", e);
            return ReturnData.error("保存用户配置失败: " + e.getMessage());
        }
    }

    /**
     * 获取用户配置
     */
    @RequestMapping(value = "/getUserConfig", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getUserConfig(@RequestParam(value = "accessToken", required = false) String accessToken) {
        try {
            String userNameSpace = getUserNameSpace(accessToken);

            String configPath = storageHelper.getUserDataPath(userNameSpace) + java.io.File.separator
                    + "userConfig.json";
            String json = storageHelper.readFile(configPath);

            if (json != null && !json.isEmpty()) {
                Map<String, Object> config = new com.google.gson.Gson().fromJson(json,
                        new com.google.gson.reflect.TypeToken<Map<String, Object>>() {
                        }.getType());
                return ReturnData.success(config);
            } else {
                return ReturnData.success(new HashMap<>());
            }
        } catch (Exception e) {
            log.error("获取用户配置失败", e);
            return ReturnData.error("获取用户配置失败: " + e.getMessage());
        }
    }
}
