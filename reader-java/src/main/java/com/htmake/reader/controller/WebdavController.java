package com.htmake.reader.controller;

import com.htmake.reader.entity.ReturnData;
import com.htmake.reader.entity.WebdavConfig;
import com.htmake.reader.service.WebdavService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

/**
 * WebDAV控制器
 */
@Slf4j
@RestController
@RequestMapping("/reader3")
public class WebdavController {

    @Autowired
    private WebdavService webdavService;

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
     * 获取WebDAV配置
     */
    @GetMapping("/getWebdavConfig")
    public ReturnData getWebdavConfig(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            WebdavConfig config = webdavService.getConfig(finalUsername);
            // 不返回密码
            config.setPassword("");
            return ReturnData.success(config);
        } catch (Exception e) {
            log.error("获取WebDAV配置失败", e);
            return ReturnData.error("获取配置失败: " + e.getMessage());
        }
    }

    /**
     * 保存WebDAV配置
     */
    @PostMapping("/saveWebdavConfig")
    public ReturnData saveWebdavConfig(@RequestBody WebdavConfig config,
            @RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = webdavService.saveConfig(config, finalUsername);
            if (success) {
                return ReturnData.success("保存成功");
            } else {
                return ReturnData.error("保存失败");
            }
        } catch (Exception e) {
            log.error("保存WebDAV配置失败", e);
            return ReturnData.error("保存失败: " + e.getMessage());
        }
    }

    /**
     * 备份到WebDAV
     */
    @PostMapping("/webdavBackup")
    public ReturnData backup(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = webdavService.backup(finalUsername);
            if (success) {
                return ReturnData.success("备份成功");
            } else {
                return ReturnData.error("备份失败，请检查WebDAV配置");
            }
        } catch (Exception e) {
            log.error("WebDAV备份失败", e);
            return ReturnData.error("备份失败: " + e.getMessage());
        }
    }

    /**
     * 从WebDAV恢复
     */
    @PostMapping("/webdavRestore")
    public ReturnData restore(@RequestParam(value = "username", required = false) String username,
            @RequestParam(value = "accessToken", required = false) String accessToken,
            HttpServletRequest request) {
        try {
            String finalUsername = getUsernameFromRequest(request, username, accessToken);
            boolean success = webdavService.restore(finalUsername);
            if (success) {
                return ReturnData.success("恢复成功");
            } else {
                return ReturnData.error("恢复失败，请检查WebDAV配置");
            }
        } catch (Exception e) {
            log.error("WebDAV恢复失败", e);
            return ReturnData.error("恢复失败: " + e.getMessage());
        }
    }

    @Autowired
    private com.htmake.reader.utils.StorageHelper storageHelper;

    @Autowired
    private com.htmake.reader.config.ReaderConfig readerConfig;

    /**
     * 获取用户命名空间
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
     * 获取用户 webdav 目录
     */
    private String getUserWebdavHome(String username) {
        String webdavPath = storageHelper.getStoragePath() + java.io.File.separator + "data"
                + java.io.File.separator + username + java.io.File.separator + "webdav";
        java.io.File dir = new java.io.File(webdavPath);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return webdavPath;
    }

    /**
     * 获取WebDAV文件列表
     */
    @RequestMapping(value = "/getWebdavFileList", method = { RequestMethod.GET, RequestMethod.POST })
    public ReturnData getWebdavFileList(
            @RequestParam(value = "path", required = false, defaultValue = "/") String path,
            @RequestParam(value = "accessToken", required = false) String accessToken) {
        try {
            String userNameSpace = getUserNameSpace(accessToken);
            String home = getUserWebdavHome(userNameSpace);

            String decodedPath = java.net.URLDecoder.decode(path, "UTF-8");
            if (decodedPath.isEmpty()) {
                decodedPath = "/";
            }

            java.io.File file = new java.io.File(home + decodedPath);
            log.info("getWebdavFileList: path={}, file={}", decodedPath, file);

            if (!file.exists()) {
                return ReturnData.error("路径不存在");
            }
            if (!file.isDirectory()) {
                return ReturnData.error("路径不是目录");
            }

            java.util.List<java.util.Map<String, Object>> fileList = new java.util.ArrayList<>();
            java.io.File[] files = file.listFiles();
            if (files != null) {
                for (java.io.File f : files) {
                    if (!f.getName().startsWith(".")) {
                        java.util.Map<String, Object> fileInfo = new java.util.HashMap<>();
                        fileInfo.put("name", f.getName());
                        fileInfo.put("size", f.length());
                        fileInfo.put("path", f.getAbsolutePath().replace(home, ""));
                        fileInfo.put("lastModified", f.lastModified());
                        fileInfo.put("isDirectory", f.isDirectory());
                        fileList.add(fileInfo);
                    }
                }
            }

            return ReturnData.success(fileList);
        } catch (Exception e) {
            log.error("获取WebDAV文件列表失败", e);
            return ReturnData.error("获取文件列表失败: " + e.getMessage());
        }
    }

    /**
     * 备份到 WebDAV（本地 webdav 目录）
     * 将用户数据打包成 zip 文件保存到 webdav 目录
     */
    @PostMapping("/backupToWebdav")
    public ReturnData backupToWebdav(@RequestParam(value = "accessToken", required = false) String accessToken) {
        try {
            String userNameSpace = getUserNameSpace(accessToken);
            String webdavHome = getUserWebdavHome(userNameSpace);
            String userDataPath = storageHelper.getUserDataPath(userNameSpace);

            // 创建备份文件名
            String timestamp = new java.text.SimpleDateFormat("yyyy-MM-dd_HH-mm-ss").format(new java.util.Date());
            String backupFileName = "backup_" + timestamp + ".zip";
            String backupFilePath = webdavHome + java.io.File.separator + backupFileName;

            // 需要备份的文件列表
            java.io.File userDataDir = new java.io.File(userDataPath);
            if (!userDataDir.exists()) {
                return ReturnData.error("用户数据目录不存在");
            }

            // 创建 zip 备份
            try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(
                    new java.io.FileOutputStream(backupFilePath))) {
                zipDirectory(userDataDir, userDataDir.getName(), zos);
            }

            log.info("备份成功: {}", backupFilePath);
            return ReturnData.success("");
        } catch (Exception e) {
            log.error("备份到WebDAV失败", e);
            return ReturnData.error("备份失败: " + e.getMessage());
        }
    }

    /**
     * 递归压缩目录
     */
    private void zipDirectory(java.io.File folder, String parentFolder, java.util.zip.ZipOutputStream zos)
            throws Exception {
        java.io.File[] files = folder.listFiles();
        if (files == null)
            return;

        for (java.io.File file : files) {
            if (file.getName().equals("webdav"))
                continue; // 跳过 webdav 目录本身
            if (file.isDirectory()) {
                zipDirectory(file, parentFolder + "/" + file.getName(), zos);
            } else {
                zos.putNextEntry(new java.util.zip.ZipEntry(parentFolder + "/" + file.getName()));
                java.nio.file.Files.copy(file.toPath(), zos);
                zos.closeEntry();
            }
        }
    }

    /**
     * 从 WebDAV 恢复（从本地 webdav 目录的备份文件恢复）
     */
    @PostMapping("/restoreFromWebdav")
    public ReturnData restoreFromWebdav(
            @RequestParam(value = "accessToken", required = false) String accessToken,
            @RequestParam(value = "path", required = false) String path) {
        try {
            String userNameSpace = getUserNameSpace(accessToken);
            String webdavHome = getUserWebdavHome(userNameSpace);
            String userDataPath = storageHelper.getUserDataPath(userNameSpace);

            // 如果没有指定路径，查找最新的备份文件
            String backupFilePath;
            if (path == null || path.isEmpty()) {
                java.io.File webdavDir = new java.io.File(webdavHome);
                java.io.File[] backupFiles = webdavDir.listFiles((dir, name) -> name.endsWith(".zip"));
                if (backupFiles == null || backupFiles.length == 0) {
                    return ReturnData.error("没有找到备份文件");
                }
                // 找到最新的备份文件
                java.io.File latestBackup = null;
                for (java.io.File f : backupFiles) {
                    if (latestBackup == null || f.lastModified() > latestBackup.lastModified()) {
                        latestBackup = f;
                    }
                }
                backupFilePath = latestBackup.getAbsolutePath();
            } else {
                backupFilePath = webdavHome + path;
            }

            java.io.File backupFile = new java.io.File(backupFilePath);
            if (!backupFile.exists()) {
                return ReturnData.error("备份文件不存在");
            }

            // 解压恢复
            try (java.util.zip.ZipInputStream zis = new java.util.zip.ZipInputStream(
                    new java.io.FileInputStream(backupFile))) {
                java.util.zip.ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    // 移除第一层目录（因为备份时包含了 userNameSpace 目录名）
                    String entryName = entry.getName();
                    int firstSlash = entryName.indexOf('/');
                    if (firstSlash >= 0) {
                        entryName = entryName.substring(firstSlash + 1);
                    }
                    if (entryName.isEmpty())
                        continue;

                    java.io.File destFile = new java.io.File(userDataPath, entryName);
                    if (entry.isDirectory()) {
                        destFile.mkdirs();
                    } else {
                        destFile.getParentFile().mkdirs();
                        java.nio.file.Files.copy(zis, destFile.toPath(),
                                java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    }
                    zis.closeEntry();
                }
            }

            log.info("恢复成功: {}", backupFilePath);
            return ReturnData.success("");
        } catch (Exception e) {
            log.error("从WebDAV恢复失败", e);
            return ReturnData.error("恢复失败: " + e.getMessage());
        }
    }
}
