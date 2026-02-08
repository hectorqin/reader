package com.htmake.reader.service;

import com.google.gson.Gson;
import com.htmake.reader.config.ReaderConfig;
import com.htmake.reader.entity.User;
import com.htmake.reader.utils.MD5Utils;
import com.htmake.reader.utils.StorageHelper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * 用户服务
 */
@Slf4j
@Service
public class UserService {

    private static final Gson GSON = new Gson();

    @Autowired
    private StorageHelper storageHelper;

    @Autowired
    private ReaderConfig readerConfig;

    /**
     * 获取所有用户
     */
    public List<User> getAllUsers() {
        List<User> userList = new ArrayList<>();
        String userListPath = getUserListPath();
        File userListFile = new File(userListPath);

        if (!userListFile.exists()) {
            return userList;
        }

        String json = storageHelper.readFile(userListPath);
        if (json == null || json.isEmpty()) {
            return userList;
        }

        try {
            User[] users = GSON.fromJson(json, User[].class);
            if (users != null) {
                for (User user : users) {
                    userList.add(user);
                }
            }
        } catch (Exception e) {
            log.error("解析用户列表失败", e);
        }

        return userList;
    }

    /**
     * 获取用户数量
     */
    public int getUserCount() {
        return getAllUsers().size();
    }

    /**
     * 根据用户名获取用户
     */
    public User getUserByUsername(String username) {
        if (username == null || username.isEmpty()) {
            return null;
        }

        List<User> users = getAllUsers();
        return users.stream()
                .filter(user -> username.equals(user.getUsername()))
                .findFirst()
                .orElse(null);
    }

    /**
     * 验证用户登录
     */
    public User login(String username, String password) {
        if (username == null || username.isEmpty() || password == null || password.isEmpty()) {
            return null;
        }

        User user = getUserByUsername(username);
        if (user == null) {
            return null;
        }

        // 验证密码（MD5加密）
        String encryptedPassword = MD5Utils.md5Encode(password);
        if (encryptedPassword.equals(user.getPassword())) {
            // 更新最后登录时间
            user.setLastLoginTime(System.currentTimeMillis());
            saveUser(user);
            return user;
        }

        return null;
    }

    /**
     * 注册用户
     */
    public boolean register(String username, String password) {
        if (username == null || username.isEmpty() || password == null || password.isEmpty()) {
            return false;
        }

        // 检查用户是否已存在
        if (getUserByUsername(username) != null) {
            return false;
        }

        // 检查用户数量限制
        if (readerConfig.getUserLimit() != null && readerConfig.getUserLimit() > 0) {
            List<User> users = getAllUsers();
            if (users.size() >= readerConfig.getUserLimit()) {
                return false;
            }
        }

        User user = new User();
        user.setUsername(username);
        user.setPassword(MD5Utils.md5Encode(password));
        user.setCreateTime(System.currentTimeMillis());
        user.setLastLoginTime(System.currentTimeMillis());
        user.setEnableWebdav(true);
        user.setEnableLocalStore(true);
        user.setEnableBookSource(true);
        user.setEnableRssSource(true);
        user.setBookSourceLimit(100);
        user.setBookLimit(200);
        user.setIsAdmin(false);

        return saveUser(user);
    }

    /**
     * 保存用户
     */
    public boolean saveUser(User user) {
        if (user == null || user.getUsername() == null || user.getUsername().isEmpty()) {
            return false;
        }

        List<User> users = getAllUsers();

        // 查找是否已存在
        boolean found = false;
        for (int i = 0; i < users.size(); i++) {
            if (users.get(i).getUsername().equals(user.getUsername())) {
                users.set(i, user);
                found = true;
                break;
            }
        }

        if (!found) {
            users.add(user);
        }

        return saveAllUsers(users);
    }

    /**
     * 删除用户
     */
    public boolean deleteUser(String username) {
        if (username == null || username.isEmpty()) {
            return false;
        }

        List<User> users = getAllUsers();
        users.removeIf(user -> username.equals(user.getUsername()));

        return saveAllUsers(users);
    }

    /**
     * 保存所有用户到文件
     */
    private boolean saveAllUsers(List<User> users) {
        String userListPath = getUserListPath();
        String json = GSON.toJson(users);
        return storageHelper.writeFile(userListPath, json);
    }

    /**
     * 获取用户列表文件路径
     */
    private String getUserListPath() {
        return storageHelper.getStoragePath() + File.separator + "data" + File.separator + "users.json";
    }
}
