FROM mysql:8.4.7@sha256:0426ec38c7a10aa45ba383887df7878f74ee70e2fd589c7b69207f3577901903
# The official server-minimal image omits mysqlbinlog. Keep the server version
# and signature checks; install only its matching official MySQL client tools.
RUN set -eu; \
    microdnf install -y cpio --setopt=install_weak_deps=0; \
    rpmArch="$(uname -m)"; \
    curl -fsSL "https://repo.mysql.com/yum/mysql-8.4-community/el/9/${rpmArch}/mysql-community-client-8.4.7-1.el9.${rpmArch}.rpm" -o /tmp/mysql-client.rpm; \
    rpm --import /etc/pki/rpm-gpg/RPM-GPG-KEY-mysql; \
    rpm --checksig /tmp/mysql-client.rpm; \
    mkdir /tmp/mysql-client; cd /tmp/mysql-client; \
    rpm2cpio /tmp/mysql-client.rpm | cpio -id ./usr/bin/mysqlbinlog; \
    install -m 0755 usr/bin/mysqlbinlog /usr/local/bin/mysqlbinlog; \
    cd /; rm -rf /tmp/mysql-client /tmp/mysql-client.rpm; \
    microdnf clean all; \
    mysqlbinlog --version
