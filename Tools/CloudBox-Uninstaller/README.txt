CloudBox 卸载与数据清理工具
============================

用途
----
彻底卸载 CloudBox，包括：
- 默认数据目录
- 通过设置更改后的自定义 data / storage / plugins 目录
- 程序安装目录
- 桌面 / 开始菜单快捷方式
- 注册表卸载项、CloudBox 软件项和启动项

程序启动时会通过 Windows UAC 申请管理员权限，以便删除 Program Files、HKLM 注册表项
和公共快捷方式。若在 UAC 提示中点击“否”，程序不会启动。

界面右上角提供“中文 / English”切换，按钮、列表、警告、确认框和卸载结果都会切换语言。

会检测的数据目录
----------------
默认位置：
1. %APPDATA%\cloudbox
   cloudbox.db、storage、plugins、config、tmp、证书、Electron 缓存等。
2. %LOCALAPPDATA%\cloudbox
   默认本地缓存（如果存在）。

自定义位置：
%APPDATA%\cloudbox\cloudbox-paths.json 中的：
- dataDir
- storageDir
- pluginsDir

自定义目录默认不勾选，需要手动确认。位于默认目录内部的自定义路径会随默认目录一起删除，
不再重复列出。

会检测的程序本体与系统集成
--------------------------
- 注册表 Uninstall 项（HKCU / HKLM，64/32 位视图）
- InstallLocation 指向的安装目录
- %LOCALAPPDATA%\Programs\CloudBox
- %ProgramFiles%\CloudBox
- %ProgramFiles(x86)%\CloudBox
- 桌面、公共桌面、开始菜单、公共开始菜单、启动文件夹中的 CloudBox.lnk
- HKCU\Software\CloudBox
- HKCU\Software\com.cloudbox.app
- HKLM\Software\CloudBox
- HKCU Run 中的 CloudBox 启动项

只有目录中存在 CloudBox.exe 或 cloudbox.exe 时，才会把它作为程序安装目录删除。

使用步骤
--------
1. 双击 CloudBoxUninstaller.exe。
2. 查看默认数据目录、自定义目录，以及检测到的程序本体/快捷方式/注册表项。
3. 取消不希望删除的项；自定义数据目录默认不勾选。
4. 点击“删除选中目录”。
5. 在确认框中确认。
6. 如果 CloudBox 正在运行，工具会询问是否关闭它。
7. 完成后弹窗列出已删除的数据目录、程序本体、快捷方式和注册表项，以及未处理/失败项。

“打开 Windows 应用卸载”按钮仅作为备用入口；勾选“同时卸载程序本体、快捷方式和注册表项”
后，本工具会直接执行对应删除。

权限说明
--------
- 程序清单使用 requireAdministrator，启动时始终请求管理员权限。
- 因此 Program Files、HKLM 注册表项、公共桌面/开始菜单快捷方式也可以删除。
- 如果 UAC 被拒绝，程序不会启动；这是有意设计，避免权限不足造成卸载不完整。
- 不建议在不受信任的目录中运行本工具。

启动语言
--------
- 默认中文。
- 右上角下拉框可切换 English。
- 语言切换后会自动重新检测目录，并同步更新界面和消息框。

安全限制
--------
- 默认数据目录必须严格位于当前用户 %APPDATA% 或 %LOCALAPPDATA% 下，且目录名为 cloudbox。
- 自定义目录只从 cloudbox-paths.json 读取；删除前做路径安全检查。
- 拒绝删除磁盘根目录、Windows、System32、Program Files 根、用户目录根、AppData 根等危险位置。
- 程序安装目录必须包含 CloudBox.exe，且不能是当前工具所在目录。
- 不跟随目录联接/符号链接删除目标内容。
- 未勾选的数据目录、程序本体、快捷方式、注册表项和其他文件不会删除。

重要提示
--------
- 删除不可恢复。请先备份需要保留的数据。
- 建议退出 CloudBox 后再运行本工具；工具也会提示关闭正在运行的 CloudBox。
- 自定义目录可能包含手动放入的文件，请只勾选确定的 CloudBox 数据目录。
- 本工具自身不会自动删除；如需清理，可手动删除 CloudBox_Uninstaller 文件夹。

源代码
------
Cleaner.cs 为完整 C# WinForms 源代码，可使用 Windows 自带的 .NET Framework 编译器重新构建。
