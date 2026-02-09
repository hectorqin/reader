package com.htmake.reader.controller;

import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.entity.User;
import com.htmake.reader.service.UserService;
import com.htmake.reader.config.ReaderConfig;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
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
     * 用户登录/注册（参考源项目 UserController.kt login 方法）
     * <p>
     * 通过 isLogin 参数区分登录和注册：
     * - isLogin = true: 登录模式，用户不存在则报错
     * - isLogin = false: 注册模式，用户已存在则报错
     * <p>
     * 登录/注册成功后，将用户名保存到 HttpSession 中，
     * 后续请求（如 getUserInfo）通过 session 自动识别当前登录用户。
     */
    @PostMapping("/login")
    public ReturnData login(@RequestBody Map<String, Object> loginData,
            HttpServletRequest request) {
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
                // 保存用户名到 session，后续请求通过 session 识别用户（参考源项目 saveUserSession）
                HttpSession session = request.getSession(true);
                session.setAttribute("username", username);
                log.info("登录成功，保存 session: username={}, sessionId={}", username, session.getId());
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

                // 保存用户名到 session，后续请求通过 session 识别用户（参考源项目 saveUserSession）
                HttpSession session = request.getSession(true);
                session.setAttribute("username", username);
                log.info("登录成功，保存 session: username={}, sessionId={}", username, session.getId());
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
     * 注销登录（参考源项目 UserController.kt logout 方法）
     * <p>
     * 销毁当前 HttpSession，前端收到 isSuccess=true 后清理本地 token。
     */
    @RequestMapping(value = "/logout", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData logout(HttpServletRequest request) {
        // 销毁 session，清除服务端登录状态
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
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
     * 获取用户信息（参考源项目 UserController.kt getUserInfo 方法）
     * <p>
     * 返回结构与前端保持一致：data 中包含 userInfo、secure、secureKey。
     * <p>
     * 用户识别优先级（与源项目 checkAuth 逻辑一致）：
     * 1. 从 HttpSession 中获取用户名（登录时已保存）
     * 2. 从 accessToken 参数中解析用户名并验证 token 有效性（自动登录场景）
     * <p>
     * 前端调用此接口时不传参数（Axios.get("/getUserInfo")），
     * 依赖 cookie 携带的 session 来识别当前登录用户。
     */
    @RequestMapping(value = "/getUserInfo", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getUserInfo(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            Map<String, Object> result = new HashMap<>();
            result.put("secure", readerConfig.getSecure());
            result.put("secureKey", readerConfig.getSecureKey() != null && !readerConfig.getSecureKey().isEmpty());

            // 第一优先级：从 session 中获取用户名（参考源项目 checkAuth 中 context.session().get("username")）
            String finalUsername = null;
            HttpSession session = request.getSession(false);
            if (session != null) {
                Object sessionUser = session.getAttribute("username");
                if (sessionUser != null && !sessionUser.toString().isEmpty()) {
                    finalUsername = sessionUser.toString();
                    log.info("getUserInfo: 从 session 获取用户名: username={}, sessionId={}", finalUsername, session.getId());
                } else {
                    log.info("getUserInfo: session 存在但没有 username 属性, sessionId={}", session.getId());
                }
            } else {
                log.info("getUserInfo: session 不存在");
            }

            // 第二优先级：从 accessToken 参数中解析用户名（自动登录场景，参考源项目 checkAuth 中 accessToken 解析逻辑）
            String token = null;
            if (finalUsername == null && accessToken != null && !accessToken.isEmpty()) {
                String[] parts = accessToken.split(":", 2);
                if (parts.length >= 2) {
                    finalUsername = parts[0];
                    token = parts[1];
                } else if (parts.length == 1) {
                    finalUsername = parts[0];
                }
            }

            // 第三优先级：从 username 参数获取
            if (finalUsername == null && username != null && !username.isEmpty()) {
                finalUsername = username;
            }

            // 未能识别用户，返回空 userInfo
            if (finalUsername == null || finalUsername.isEmpty()) {
                result.put("userInfo", null);
                return ReturnData.success(result);
            }

            User user = userService.getUserByUsername(finalUsername);
            if (user == null) {
                result.put("userInfo", null);
                return ReturnData.success(result);
            }

            // 如果是通过 accessToken 自动登录，需要验证 token 有效性
            // 验证通过后恢复 session（参考源项目 checkAuth 中 saveUserSession(context, userMap, existedUser, false)）
            if (session == null || session.getAttribute("username") == null) {
                if (token != null && !token.isEmpty()) {
                    boolean isValidToken = false;
                    // 检查是否与当前 token 匹配
                    if (token.equals(user.getToken())) {
                        isValidToken = true;
                    }
                    // 检查历史 tokenMap（参考源项目 checkAuth 中 tokenMap 验证逻辑）
                    if (!isValidToken && user.getTokenMap() != null) {
                        Long expireTime = user.getTokenMap().get(token);
                        if (expireTime != null && expireTime > System.currentTimeMillis()) {
                            isValidToken = true;
                            // 延长 token 有效期
                            user.getTokenMap().put(token, System.currentTimeMillis() + LOGIN_EXPIRE_DAYS * 86400L * 1000L);
                            userService.saveUser(user);
                        }
                    }

                    if (isValidToken) {
                        // token 验证通过，恢复 session
                        HttpSession newSession = request.getSession(true);
                        newSession.setAttribute("username", finalUsername);
                    } else if (readerConfig.getSecure() != null && readerConfig.getSecure()) {
                        // 安全模式下 token 无效，返回空 userInfo
                        result.put("userInfo", null);
                        return ReturnData.success(result);
                    }
                } else if (readerConfig.getSecure() != null && readerConfig.getSecure()) {
                    // 安全模式下没有 session 也没有 token，返回空 userInfo
                    result.put("userInfo", null);
                    return ReturnData.success(result);
                }
            }

            // 构建 userInfo 返回（参考源项目 formatUser 方法的返回字段）
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

            log.info("getUserInfo 返回数据: secure={}, userInfo.username={}, 完整结果={}",
                result.get("secure"), userInfo.get("username"), result);
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
