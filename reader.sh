#!/bin/bash

red='\033[0;31m'
green="\033[32m"
yellow='\033[0;33m'
plain='\033[0m'

file_dir=""
remotePort=""

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
        yum update && yum install wget curl docker -y 
        curl -L "https://ghproxy.com/https://ghproxy.com/https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
    else
        apt update && apt install wget curl docker-compose -y
    fi
}

install_reader() {
    mkdir ${orgin_file_dir}
    cd ${orgin_file_dir}
    rm docker-compose*
    wget https://ghproxy.com/https://raw.githubusercontent.com/hectorqin/reader/master/docker-compose.yml
    sed -i "s/\/home\/reader/${file_dir}/" docker-compose.yml
    sed -i "s/4396/${remotePort}/" docker-compose.yml
    # 多用户
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
		 echo -e "端口号不正确,请输入0-65535"
		 getRemotePort
		 exit 0
		fi
	else
        echo -e "端口号不正确,请输入0-65535"
	    getRemotePort
	    exit 0
    fi
}


getfileDir () {
    echo -e "${green} 请输入数据存放目录,例如 /home/reader : ${plain}"
    read -p "不填默认为/home/reader: " file_dir
    if [[ -z "$file_dir" ]];then
        file_dir="/home/reader"
    fi
    orgin_file_dir=$file_dir
    file_dir=${file_dir//\//\\\/}
}

Server_IP=''
getIpaddr () {
    Server_IP=`ip addr | grep 'state UP' -A2 | grep inet | egrep -v '(127.0.0.1|inet6|docker)' | awk '{print $2}' | tr -d "addr:" | head -n 1 | cut -d / -f1`
}

echo -e "${green}开始安装${plain}"
install_dockercompose
getfileDir
getRemotePort
install_reader
getIpaddr
echo -e "${green}初步部署完成,国内服务器请在控制台打开端口${remotePort}${plain}"
echo -e "${green}浏览器打开网页${plain} http://${Server_IP}:${remotePort}"
echo -e "${green}如需修改其他配置请前往${orgin_file_dir}根据注释修改docker-compose.yml文件后${plain}"
echo -e "${green}通过命令docker-compose up -d 重启即可${plain}"
