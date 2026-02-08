package com.htmake.reader.entity;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 用户实体类
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class User {

    /** 用户名 */
    private String username;

    /** 密码 */
    private String password;

    /** 创建时间 */
    private Long createTime;

    /** 最后登录时间 */
    private Long lastLoginTime;

    /** 是否启用webdav */
    private Boolean enableWebdav = true;

    /** 是否启用本地书仓 */
    private Boolean enableLocalStore = true;

    /** 是否可编辑书源 */
    private Boolean enableBookSource = true;

    /** 是否可编辑RSS源 */
    private Boolean enableRssSource = true;

    /** 书源上限 */
    private Integer bookSourceLimit = 100;

    /** 书籍上限 */
    private Integer bookLimit = 200;

    /** 是否为管理员 */
    private Boolean isAdmin = false;

    /** 当前登录 token */
    private String token;

    /** 历史有效 token 及其过期时间 (token -> expireTime) */
    private java.util.Map<String, Long> tokenMap;
}
