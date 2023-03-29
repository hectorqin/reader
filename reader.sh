#!/bin/bash

red='\033[0;31m'
green="\033[32m"
yellow='\033[0;33m'
plain='\033[0m'

file_dir=""
remotePort=""
isMultiUser=""
adminPassword=""
registerCode=""
strTrue="true"
dockerImages=""

# CheckRoot
if [[ $EUID -ne 0 ]]; then
    echo "请使用root用户登录!" 1>&2
    exit 1
fi

# CheckSystem
if [[ -f /etc/redhat-release ]]; then
    release="centos"
elif cat /etc/issue | grep -q -E -i "debian"; then
    release="debian"
elif cat /etc/issue | grep -q -E -i "ubuntu"; then
    release="ubuntu"
elif cat /etc/issue | grep -q -E -i "centos|red hat|redhat"; then
    release="centos"
elif cat /proc/version | grep -q -E -i "debian"; then
    release="debian"
elif cat /proc/version | grep -q -E -i "ubuntu"; then
    release="ubuntu"
elif cat /proc/version | grep -q -E -i "centos|red hat|redhat"; then
    release="centos"
fi
bit=$(uname -m)
    if test "$bit" != "x86_64"; then
        bit="arm64"
    else bit="amd64"
fi

os_version=""

# os version
if [[ -f /etc/os-release ]]; then
    os_version=$(awk -F'[= ."]' '/VERSION_ID/{print $3}' /etc/os-release)
fi
if [[ -z "$os_version" && -f /etc/lsb-release ]]; then
    os_version=$(awk -F'[= ."]+' '/DISTRIB_RELEASE/{print $2}' /etc/lsb-release)
fi

if [[ x"${release}" == x"centos" ]]; then
    if [[ ${os_version} -le 6 ]]; then
        echo -e "${red}请使用 CentOS 7 或更高版本的系统！${plain}\n" && exit 1
    fi
elif [[ x"${release}" == x"ubuntu" ]]; then
    if [[ ${os_version} -lt 16 ]]; then
        echo -e "${red}请使用 Ubuntu 16 或更高版本的系统！${plain}\n" && exit 1
    fi
elif [[ x"${release}" == x"debian" ]]; then
    if [[ ${os_version} -lt 9 ]]; then
        echo -e "${red}请使用 Debian 9 或更高版本的系统！${plain}\n" && exit 1
    fi
fi

install_dockercompose() {
    if [[ x"${release}" == x"centos" ]]; then
        yum install wget curl -y 
        echo -e "${green} 正在移除CentOS遗留无效Docker文件 ${plain}"
        yum remove docker docker-client docker-client-latest docker-common docker-latest docker-latest-logrotate docker-logrotate docker-engine -y
        echo -e "${green} 正在安装Docker ${plain}"
        yum install yum-utils device-mapper-persistent-data lvm2 -y
        yum-config-manager --add-repo http://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
        yum install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y
        echo -e "${green} 正在启动Docker ${plain}"
        systemctl start docker
        systemctl restart docker
        systemctl enable docker
        echo -e "${green} 正在安装docker-compose ${plain}"
        curl -L "https://ghproxy.com/https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
    else
        echo -e "${green} 正在安装docker-compose ${plain}"
        apt update && apt install wget curl docker-compose -y
    fi
}

install_reader() {
    mkdir -p ${orgin_file_dir}/storage/data/default
    cd ${orgin_file_dir}
    rm docker-compose*
    wget https://ghproxy.com/https://raw.githubusercontent.com/hectorqin/reader/master/docker-compose.yml
    echo -e "${green} 正在配置默认书源 ${plain}"
    wget https://legado.pages.dev/sy-yc.json -O storage/data/default/bookSource.json
    echo -e "${green} 正在配置docker变量 ${plain}"
    sed -i "s/\/home\/reader/${file_dir}/" docker-compose.yml
    sed -i "s/4396/${remotePort}/" docker-compose.yml
    sed -i "s/openj9-latest/${dockerImages}/" docker-compose.yml
    # 多用户
    sed -i "s/READER_APP_SECURE\=true/READER_APP_SECURE\=${isMultiUser}/" docker-compose.yml
    sed -i "s/adminpwd/${adminPassword}/" docker-compose.yml
    sed -i "s/registercode/${registerCode}/" docker-compose.yml
    echo -e "${green} 准备启动 ${plain}"
    # 远程webview
    docker-compose up -d
}

getRemotePort () {
    echo "请输入部署端口,例如 4396"
    read -p "不填默认为4396: " remotePort
    if [[ -z "$remotePort" ]];then
    	remotePort="4396"
    fi
    if [ "$remotePort" -gt 0 ] 2>/dev/null;then
		if [[ $remotePort -lt 0 || $remotePort -gt 65535 ]];then
		 echo -e "${red} 端口号不正确,请输入0-65535${plain}"
		 getRemotePort
		 exit 0
		fi
	else
        echo -e "${red} 端口号不正确,请输入0-65535${plain}"
	    getRemotePort
	    exit 0
    fi
}


getfileDir () {
    echo -e "${green} 请输入数据存放目录,例如 /home/reader : ${plain}"
    read -p "不填默认为/home/reader : " file_dir
    if [[ -z "$file_dir" ]];then
        file_dir="/home/reader"
    fi
    orgin_file_dir=$file_dir
    file_dir=${file_dir//\//\\\/}
}

getMultiUser () {
    echo -e "${green} 是否需要开启多用户 : ${plain}"
    read -p "填0不开启,不填开启 : " isMultiUser
    if [[ -z "$isMultiUser" ]];then
        isMultiUser="true"
    else
        isMultiUser="false"
    fi
}

getPwdOrCode () {
    echo -e "${green} 请输入管理密码,用于加载用户空间 : ${plain}"
    read -p "建议修改此参数,默认为adminpwd : " adminPassword
    if [[ -z "$adminPassword" ]];then
        adminPassword="adminpwd"
    fi
    echo -e "${green} 请输入邀请码,用于注册使用 : ${plain}"
    read -p "不填默认为空 : " registerCode
    if [[ -z "$registerCode" ]];then
        registerCode=""
    fi
}

getDockerImages () {
    echo -e "${green} 请输入需要的镜像 arm或者小内存(1G)机器建议openj9,其余建议基础镜像 : ${plain}"
    read -p "不输入为基础镜像,输入其他值为openj9 : " dockerImages
    if [[ -z "$dockerImages" ]];then
        dockerImages="latest"
    else
        dockerImages="openj9-latest"
    fi
}

Server_IP=''
Public_IP=''
getIpaddr () {
    Server_IP=$(hostname -I | awk -F " " '{printf $1}')
    Public_IP=$(curl http://pv.sohu.com/cityjson 2>> /dev/null | awk -F '"' '{print $4}')
}

echo -e "${green}准备部署reader${plain}"
echo -e "${green}甲骨文官方系统可能并不适用此脚本,本脚本仅测试CentOS7,8,Ubuntu20+,Debian10+${plain}"
install_dockercompose
getfileDir
getRemotePort
getMultiUser
if [ $isMultiUser == "true" ]; then
    getPwdOrCode
fi
getDockerImages
install_reader
getIpaddr

echo -e "${green}初步部署完成,已配置默认书源,国内服务器等有控制台面板的服务器厂商请手动在控制台打开reader所需的端口${remotePort}${plain}"
if [ $Server_IP == $Public_IP ];then
    echo -e "${green}网址:${plain} http://${Server_IP}:${remotePort}"
else
    echo -e "${green}内网网址:${plain} http://${Server_IP}:${remotePort}"
    echo -e "${green}公网网址:${plain} http://${Public_IP}:${remotePort}"
fi

echo -e "${green}如需修改其他配置请前往 cd${orgin_file_dir} 根据注释修改 vim docker-compose.yml文件后${plain}"
echo -e "${green}先自行学习vim用法,否者建议使用sftp或WindTerm等ssh自带sftp的软件直接打开编辑${plain}"
echo -e "${green}修改后前往 cd${orgin_file_dir} 后通过命令docker-compose up -d 重启即可${plain}"