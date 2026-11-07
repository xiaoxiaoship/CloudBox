using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using Microsoft.Win32;

namespace CloudBoxCleaner
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new CleanerForm());
        }
    }

    internal sealed class CleanerForm : Form
    {
        private readonly ListView list = new ListView();
        private readonly Label summary = new Label();
        private readonly Label customNotice = new Label();
        private readonly Label titleLabel = new Label();
        private readonly Label subtitleLabel = new Label();
        private readonly Label pathLabel = new Label();
        private readonly Label warningText = new Label();
        private readonly ComboBox languageBox = new ComboBox();
        private readonly Button refreshButton = new Button();
        private readonly Button selectAllButton = new Button();
        private readonly Button selectNoneButton = new Button();
        private readonly Button cleanButton = new Button();
        private readonly Button appsButton = new Button();
        private readonly CheckBox appCheck = new CheckBox();
        private readonly Label status = new Label();
        private readonly List<TargetDirectory> targets = new List<TargetDirectory>();
        private AppInstallation appInstallation = new AppInstallation();
        private bool english;

        public CleanerForm()
        {
            Text = "CloudBox 卸载与数据清理工具";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(860, 680);
            Size = new Size(980, 740);
            BackColor = Color.FromArgb(15, 23, 42);
            ForeColor = Color.FromArgb(226, 232, 240);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point, 134);

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 108;
            header.BackColor = Color.FromArgb(30, 41, 59);
            Controls.Add(header);

            titleLabel.Text = "CloudBox 卸载与数据清理工具";
            titleLabel.Font = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold);
            titleLabel.ForeColor = Color.White;
            titleLabel.UseMnemonic = false;
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(24, 20);
            header.Controls.Add(titleLabel);

            subtitleLabel.Text = "可选择清理默认目录，以及通过设置更改后的自定义 data / storage / plugins 目录。";
            subtitleLabel.ForeColor = Color.FromArgb(148, 163, 184);
            subtitleLabel.AutoSize = true;
            subtitleLabel.Location = new Point(27, 63);
            header.Controls.Add(subtitleLabel);

            languageBox.DropDownStyle = ComboBoxStyle.DropDownList;
            languageBox.Items.Add("中文");
            languageBox.Items.Add("English");
            languageBox.SelectedIndex = 0;
            languageBox.Location = new Point(850, 34);
            languageBox.Size = new Size(100, 26);
            languageBox.BackColor = Color.FromArgb(15, 23, 42);
            languageBox.ForeColor = Color.White;
            languageBox.FlatStyle = FlatStyle.Flat;
            languageBox.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            languageBox.SelectedIndexChanged += delegate
            {
                english = languageBox.SelectedIndex == 1;
                ApplyLanguage();
                RefreshLocations();
            };
            header.Controls.Add(languageBox);

            pathLabel = new Label();
            pathLabel.Text = "检测到的目录（勾选后才会删除）";
            pathLabel.ForeColor = Color.FromArgb(203, 213, 225);
            pathLabel.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold);
            pathLabel.AutoSize = true;
            pathLabel.Location = new Point(24, 128);
            Controls.Add(pathLabel);

            summary.AutoSize = false;
            summary.Location = new Point(24, 156);
            summary.Size = new Size(910, 24);
            summary.ForeColor = Color.FromArgb(148, 163, 184);
            Controls.Add(summary);

            list.Location = new Point(24, 188);
            list.Size = new Size(910, 214);
            list.View = View.Details;
            list.CheckBoxes = true;
            list.FullRowSelect = true;
            list.GridLines = false;
            list.HideSelection = false;
            list.BackColor = Color.FromArgb(30, 41, 59);
            list.ForeColor = Color.FromArgb(226, 232, 240);
            list.BorderStyle = BorderStyle.FixedSingle;
            list.Columns.Add("目录", 520);
            list.Columns.Add("来源", 190);
            list.Columns.Add("占用", 95);
            list.Columns.Add("状态", 95);
            list.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            list.ItemChecked += delegate { UpdateButtonState(); };
            Controls.Add(list);

            Panel warning = new Panel();
            warning.Location = new Point(24, 418);
            warning.Size = new Size(910, 104);
            warning.BackColor = Color.FromArgb(69, 45, 20);
            warning.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(warning);

            warningText = new Label();
            warningText.Text = "重要：只删除列表中勾选的数据目录，以及下方勾选的程序本体、快捷方式和注册表项；删除不可恢复。\n" +
                "默认数据目录和检测到的程序项已自动勾选；自定义数据目录默认不勾选，请确认后再勾选。\n" +
                "Program Files / HKLM 等项目可能需要管理员权限；失败项会在结果中列出。";
            warningText.ForeColor = Color.FromArgb(253, 230, 138);
            warningText.AutoSize = false;
            warningText.Dock = DockStyle.Fill;
            warningText.Padding = new Padding(12, 10, 12, 6);
            warning.Controls.Add(warningText);

            customNotice.Location = new Point(24, 532);
            customNotice.Size = new Size(910, 24);
            customNotice.ForeColor = Color.FromArgb(251, 146, 60);
            customNotice.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(customNotice);

            refreshButton.Text = "重新检测";
            appCheck.Text = "同时卸载程序本体、快捷方式和注册表项";            appCheck.Location = new Point(24, 554);
            appCheck.Size = new Size(620, 24);
            appCheck.ForeColor = Color.FromArgb(251, 191, 36);
            appCheck.BackColor = Color.Transparent;
            appCheck.Enabled = false;
            appCheck.CheckedChanged += delegate { UpdateButtonState(); };
            Controls.Add(appCheck);

            refreshButton.Location = new Point(24, 592);
            refreshButton.Size = new Size(110, 38);
            refreshButton.BackColor = Color.FromArgb(51, 65, 85);
            refreshButton.ForeColor = Color.White;
            refreshButton.FlatStyle = FlatStyle.Flat;
            refreshButton.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            refreshButton.Click += delegate { RefreshLocations(); };
            Controls.Add(refreshButton);

            selectAllButton.Text = "全选";
            selectAllButton.Location = new Point(144, 592);
            selectAllButton.Size = new Size(90, 38);
            selectAllButton.BackColor = Color.FromArgb(51, 65, 85);
            selectAllButton.ForeColor = Color.White;
            selectAllButton.FlatStyle = FlatStyle.Flat;
            selectAllButton.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            selectAllButton.Click += delegate { SetAllChecked(true); };
            Controls.Add(selectAllButton);

            selectNoneButton.Text = "全不选";
            selectNoneButton.Location = new Point(244, 592);
            selectNoneButton.Size = new Size(90, 38);
            selectNoneButton.BackColor = Color.FromArgb(51, 65, 85);
            selectNoneButton.ForeColor = Color.White;
            selectNoneButton.FlatStyle = FlatStyle.Flat;
            selectNoneButton.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            selectNoneButton.Click += delegate { SetAllChecked(false); };
            Controls.Add(selectNoneButton);

            appsButton.Text = "打开 Windows 应用卸载";
            appsButton.Location = new Point(24, 648);
            appsButton.Size = new Size(190, 34);
            appsButton.BackColor = Color.FromArgb(30, 41, 59);
            appsButton.ForeColor = Color.FromArgb(203, 213, 225);
            appsButton.FlatStyle = FlatStyle.Flat;
            appsButton.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            appsButton.Click += delegate
            {
                try { Process.Start("ms-settings:appsfeatures"); }
                catch (Exception ex) { MessageBox.Show(this, T("无法打开 Windows 应用列表：", "Unable to open Windows Apps: ") + ex.Message, T("CloudBox 清理", "CloudBox Cleanup"), MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            };
            Controls.Add(appsButton);

            cleanButton.Text = "删除选中目录";
            cleanButton.Location = new Point(760, 592);
            cleanButton.Size = new Size(174, 38);
            cleanButton.BackColor = Color.FromArgb(190, 24, 93);
            cleanButton.ForeColor = Color.White;
            cleanButton.FlatStyle = FlatStyle.Flat;
            cleanButton.FlatAppearance.BorderColor = Color.FromArgb(244, 63, 94);
            cleanButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            cleanButton.Click += delegate { Clean(); };
            Controls.Add(cleanButton);

            status.Location = new Point(344, 600);
            status.Size = new Size(400, 24);
            status.ForeColor = Color.FromArgb(148, 163, 184);
            status.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            Controls.Add(status);

            RefreshLocations();
        }

        private string T(string zh, string en)
        {
            return english ? en : zh;
        }

        private void ApplyLanguage()
        {
            Text = T("CloudBox 卸载与数据清理工具", "CloudBox Uninstaller & Data Cleanup");
            titleLabel.Text = T("CloudBox 卸载与数据清理工具", "CloudBox Uninstaller & Data Cleanup");
            subtitleLabel.Text = T(
                "可选择清理默认目录，以及通过设置更改后的自定义 data / storage / plugins 目录。",
                "Remove the default data folders and any custom data / storage / plugins folders changed in Settings.");
            pathLabel.Text = T("检测到的目录（勾选后才会删除）", "Detected folders (only checked items are deleted)");
            list.Columns[0].Text = T("目录", "Folder");
            list.Columns[1].Text = T("来源", "Source");
            list.Columns[2].Text = T("占用", "Size");
            list.Columns[3].Text = T("状态", "Status");
            warningText.Text = T(
                "重要：只删除列表中勾选的数据目录，以及下方勾选的程序本体、快捷方式和注册表项；删除不可恢复。\n默认数据目录和检测到的程序项已自动勾选；自定义数据目录默认不勾选，请确认后再勾选。\nProgram Files / HKLM 等项目可能需要管理员权限；失败项会在结果中列出。",
                "Important: only checked data folders and checked program files, shortcuts and registry entries are removed. Deletion cannot be undone.\nDefault data folders and detected program items are checked automatically; custom folders are not checked by default.\nProgram Files / HKLM items may require administrator rights; failures are listed in the result.");
            refreshButton.Text = T("重新检测", "Rescan");
            selectAllButton.Text = T("全选", "Select all");
            selectNoneButton.Text = T("全不选", "Clear all");
            appsButton.Text = T("打开 Windows 应用卸载", "Open Windows Apps");
            appCheck.Text = T("同时卸载程序本体、快捷方式和注册表项", "Also remove program files, shortcuts and registry entries") +
                "  |  " + AppSummary();
            status.Text = T("就绪。勾选目录后点击“删除选中目录”。", "Ready. Select folders, then click Delete Selected.");
        }

        private void RefreshLocations()
        {
            targets.Clear();
            list.Items.Clear();
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string defaultData = Path.Combine(roaming, "cloudbox");
            string defaultCache = Path.Combine(local, "cloudbox");

            AddTarget(defaultData, "defaultData", true, true);
            AddTarget(defaultCache, "defaultCache", true, true);
            ReadCustomTargets(defaultData, roaming);

            long total = 0;
            foreach (TargetDirectory target in targets)
            {
                long size = GetDirectorySize(target.Path);
                if (target.Checked) total += size;
                ListViewItem item = new ListViewItem(target.Path);
                item.SubItems.Add(GetSourceLabel(target.Source));
                item.SubItems.Add(FormatSize(size));
                item.SubItems.Add(Directory.Exists(target.Path) ? T("存在", "Exists") : T("不存在", "Missing"));
                item.Checked = target.Checked;
                item.Tag = target;
                list.Items.Add(item);
            }

            summary.Text = string.Format(T("共检测到 {0} 个目录，当前勾选合计约 {1}。自定义目录默认不勾选。", "Detected {0} folders; selected total about {1}. Custom folders are unchecked by default."), targets.Count, FormatSize(total));
            customNotice.Text = HasCustomTargets()
                ? T("橙色/自定义目录来自 cloudbox-paths.json；请确认路径无误后再勾选。", "Custom folders come from cloudbox-paths.json; verify the paths before selecting them.")
                : T("未发现默认位置之外的自定义目录，或 cloudbox-paths.json 不存在。", "No custom folders outside the default locations were found, or cloudbox-paths.json does not exist.");
            appInstallation = DetectApplication();
            appCheck.Enabled = appInstallation.HasAnything;
            appCheck.Checked = appInstallation.HasAnything;
            appCheck.Text = T("同时卸载程序本体、快捷方式和注册表项", "Also remove program files, shortcuts and registry entries") + "  |  " + AppSummary();
            status.Text = T("就绪。勾选目录后点击“删除选中目录”。", "Ready. Select folders, then click Delete Selected.");
            UpdateButtonState();
        }

        private void ReadCustomTargets(string defaultData, string roaming)
        {
            string configFile = Path.Combine(defaultData, "cloudbox-paths.json");
            if (!File.Exists(configFile)) return;
            try
            {
                string json = File.ReadAllText(configFile);
                AddConfigTarget(json, "dataDir", "customData", defaultData);
                AddConfigTarget(json, "storageDir", "customStorage", defaultData);
                AddConfigTarget(json, "pluginsDir", "customPlugins", defaultData);
            }
            catch (Exception ex)
            {
                customNotice.Text = T("cloudbox-paths.json 读取失败：", "Failed to read cloudbox-paths.json: ") + ex.Message;
            }
        }

        private void AddConfigTarget(string json, string key, string source, string defaultData)
        {
            Match match = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"([^\"]+)\"");
            if (!match.Success) return;
            string value;
            try { value = Regex.Unescape(match.Groups[1].Value); }
            catch { return; }
            if (string.IsNullOrWhiteSpace(value)) return;
            string full;
            try { full = Path.GetFullPath(value).TrimEnd('\\'); }
            catch { return; }
            if (string.IsNullOrEmpty(full) || full.Length < 4) return;
            if (IsSameOrChild(full, defaultData)) return;
            if (targets.Any(x => string.Equals(x.Path, full, StringComparison.OrdinalIgnoreCase))) return;
            AddTarget(full, source, false, false);
        }

        private void AddTarget(string path, string source, bool isDefault, bool isChecked)
        {
            string full = Path.GetFullPath(path).TrimEnd('\\');
            if (targets.Any(x => string.Equals(x.Path, full, StringComparison.OrdinalIgnoreCase))) return;
            targets.Add(new TargetDirectory(full, source, isDefault, isChecked));
        }

        private bool HasCustomTargets()
        {
            return targets.Any(x => !x.IsDefault);
        }

        private string GetSourceLabel(string source)
        {
            if (source == "defaultData") return T("默认数据目录", "Default data folder");
            if (source == "defaultCache") return T("默认缓存目录", "Default cache folder");
            if (source == "customData") return T("自定义 dataDir", "Custom dataDir");
            if (source == "customStorage") return T("自定义 storageDir", "Custom storageDir");
            if (source == "customPlugins") return T("自定义 pluginsDir", "Custom pluginsDir");
            return source;
        }

        private string AppSummary()
        {
            if (!appInstallation.HasAnything)
            {
                return T("未检测到已安装的 CloudBox 程序本体（便携版可能没有注册表项）",
                    "No installed CloudBox program detected (portable editions may have no registry entries)");
            }
            int registryCount = appInstallation.RegistryEntries.Count + (appInstallation.RunValue ? 1 : 0);
            return string.Format(T("安装目录 {0} · 快捷方式 {1} · 注册表项 {2}",
                "Install folders {0} · shortcuts {1} · registry entries {2}"),
                appInstallation.InstallDirs.Count, appInstallation.Shortcuts.Count, registryCount);
        }

        private void SetAllChecked(bool value)
        {
            foreach (ListViewItem item in list.Items)
            {
                item.Checked = value;
            }
            UpdateButtonState();
        }

        private void UpdateButtonState()
        {
            int checkedCount = list.CheckedItems.Count;
            bool appSelected = appCheck.Checked && appInstallation.HasAnything;
            cleanButton.Enabled = checkedCount > 0 || appSelected;
            if (appSelected && checkedCount > 0) cleanButton.Text = string.Format(T("卸载程序 + 清理 {0} 个目录", "Uninstall + clean {0} folders"), checkedCount);
            else if (appSelected) cleanButton.Text = T("卸载程序本体", "Uninstall program");
            else if (checkedCount > 0) cleanButton.Text = string.Format(T("删除选中的 {0} 个目录", "Delete {0} selected folders"), checkedCount);
            else cleanButton.Text = T("删除选中目录", "Delete selected folders");
            long total = 0;
            foreach (ListViewItem item in list.Items)
            {
                if (!item.Checked) continue;
                TargetDirectory target = item.Tag as TargetDirectory;
                if (target != null) total += GetDirectorySize(target.Path);
            }
            summary.Text = string.Format(T("共检测到 {0} 个目录，当前勾选合计约 {1}。自定义目录默认不勾选。", "Detected {0} folders; selected total about {1}. Custom folders are unchecked by default."), targets.Count, FormatSize(total));
        }

        private AppInstallation DetectApplication()
        {
            AppInstallation app = new AppInstallation();
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string commonDesktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
            string startMenu = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
            string commonStartMenu = Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms);
            string startup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);

            AddInstallDir(app, Path.Combine(local, "Programs", "CloudBox"));
            AddInstallDir(app, Path.Combine(programFiles, "CloudBox"));
            AddInstallDir(app, Path.Combine(programFilesX86, "CloudBox"));

            AddShortcut(app, Path.Combine(desktop, "CloudBox.lnk"));
            AddShortcut(app, Path.Combine(commonDesktop, "CloudBox.lnk"));
            AddShortcut(app, Path.Combine(startMenu, "CloudBox.lnk"));
            AddShortcut(app, Path.Combine(startMenu, "CloudBox", "CloudBox.lnk"));
            AddShortcut(app, Path.Combine(commonStartMenu, "CloudBox.lnk"));
            AddShortcut(app, Path.Combine(commonStartMenu, "CloudBox", "CloudBox.lnk"));
            AddShortcut(app, Path.Combine(startup, "CloudBox.lnk"));

            foreach (RegistryHive hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
            {
                foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
                {
                    try
                    {
                        using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                        using (RegistryKey uninstall = baseKey.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
                        {
                            if (uninstall == null) continue;
                            foreach (string subName in uninstall.GetSubKeyNames())
                            {
                                try
                                {
                                    using (RegistryKey entry = uninstall.OpenSubKey(subName))
                                    {
                                        if (entry == null) continue;
                                        string displayName = Convert.ToString(entry.GetValue("DisplayName"));
                                        if (string.IsNullOrWhiteSpace(displayName)) continue;
                                        bool isCloudBox = string.Equals(displayName, "CloudBox", StringComparison.OrdinalIgnoreCase) ||
                                            displayName.StartsWith("CloudBox ", StringComparison.OrdinalIgnoreCase);
                                        if (!isCloudBox) continue;
                                        AddRegistryEntry(app, hive, view, @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + subName);
                                        string installLocation = Convert.ToString(entry.GetValue("InstallLocation"));
                                        if (!string.IsNullOrWhiteSpace(installLocation))
                                        {
                                            AddInstallDir(app, installLocation);
                                        }
                                    }
                                }
                                catch { }
                            }
                        }
                    }
                    catch { }
                }
            }

            AddKnownRegistryKey(app, RegistryHive.CurrentUser, @"Software\CloudBox");
            AddKnownRegistryKey(app, RegistryHive.CurrentUser, @"Software\com.cloudbox.app");
            AddKnownRegistryKey(app, RegistryHive.LocalMachine, @"Software\CloudBox");

            try
            {
                using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false))
                {
                    if (run != null && run.GetValue("CloudBox") != null) app.RunValue = true;
                }
            }
            catch { }

            app.Summary = app.HasAnything ? "detected" : "none";
            return app;
        }

        private static void AddInstallDir(AppInstallation app, string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            string full;
            try { full = Path.GetFullPath(path.Trim().Trim('"')).TrimEnd('\\'); }
            catch { return; }
            if (!Directory.Exists(full)) return;
            if (!File.Exists(Path.Combine(full, "CloudBox.exe")) && !File.Exists(Path.Combine(full, "cloudbox.exe"))) return;
            if (app.InstallDirs.Any(x => string.Equals(x, full, StringComparison.OrdinalIgnoreCase))) return;
            app.InstallDirs.Add(full);
        }

        private static void AddShortcut(AppInstallation app, string path)
        {
            if (File.Exists(path) && !app.Shortcuts.Any(x => string.Equals(x, path, StringComparison.OrdinalIgnoreCase)))
            {
                app.Shortcuts.Add(path);
            }
        }

        private static void AddRegistryEntry(AppInstallation app, RegistryHive hive, RegistryView view, string path)
        {
            if (app.RegistryEntries.Any(x => x.Hive == hive && x.View == view && string.Equals(x.Path, path, StringComparison.OrdinalIgnoreCase))) return;
            app.RegistryEntries.Add(new RegistryEntry(hive, view, path));
        }

        private static void AddKnownRegistryKey(AppInstallation app, RegistryHive hive, string path)
        {
            foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                    using (RegistryKey key = baseKey.OpenSubKey(path))
                    {
                        if (key != null) AddRegistryEntry(app, hive, view, path);
                    }
                }
                catch { }
            }
        }

        private bool UninstallApplication(AppInstallation app, List<string> actions, List<string> failures)
        {
            foreach (string installDir in app.InstallDirs)
            {
                if (!IsSafeInstallDir(installDir))
                {
                    failures.Add(installDir + T("（安装目录安全校验未通过）", " (install folder failed safety check)"));
                    continue;
                }
                try
                {
                    DeleteDirectory(installDir);
                    actions.Add(T("程序本体: ", "Program files: ") + installDir);
                }
                catch (Exception ex)
                {
                    failures.Add(installDir + "（" + ex.Message + "）");
                }
            }

            foreach (string shortcut in app.Shortcuts)
            {
                try
                {
                    if (File.Exists(shortcut)) File.Delete(shortcut);
                    actions.Add(T("快捷方式: ", "Shortcut: ") + shortcut);
                }
                catch (Exception ex)
                {
                    failures.Add(shortcut + "（" + ex.Message + "）");
                }
            }

            foreach (RegistryEntry registry in app.RegistryEntries)
            {
                try
                {
                    using (RegistryKey baseKey = RegistryKey.OpenBaseKey(registry.Hive, registry.View))
                    {
                        baseKey.DeleteSubKeyTree(registry.Path, false);
                    }
                    actions.Add("注册表: " + registry.Hive + "\\" + registry.Path);
                }
                catch (Exception ex)
                {
                    failures.Add(T("注册表 ", "Registry ") + registry.Path + " (" + ex.Message + ")");
                }
            }

            if (app.RunValue)
            {
                try
                {
                    using (RegistryKey run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (run != null) run.DeleteValue("CloudBox", false);
                    }
                    using (RegistryKey approved = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", true))
                    {
                        if (approved != null) approved.DeleteValue("CloudBox", false);
                    }
                    actions.Add("注册表启动项: HKCU\\...\\Run\\CloudBox");
                }
                catch (Exception ex)
                {
                    failures.Add(T("注册表启动项（", "Registry startup (") + ex.Message + ")");
                }
            }

            RemoveEmptyShortcutFolders(app.Shortcuts);
            return failures.Count == 0;
        }

        private static bool IsSafeInstallDir(string path)
        {
            string full = Path.GetFullPath(path).TrimEnd('\\');
            if (full.Length < 4 || full == Path.GetPathRoot(full).TrimEnd('\\')) return false;
            if (!File.Exists(Path.Combine(full, "CloudBox.exe")) && !File.Exists(Path.Combine(full, "cloudbox.exe"))) return false;
            string current = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
            return !IsSameOrChild(current, full);
        }

        private static void RemoveEmptyShortcutFolders(List<string> shortcuts)
        {
            foreach (string shortcut in shortcuts)
            {
                string parent = Path.GetDirectoryName(shortcut);
                if (parent == null || !Directory.Exists(parent)) continue;
                try
                {
                    if (Directory.GetFileSystemEntries(parent).Length == 0) Directory.Delete(parent, false);
                }
                catch { }
            }
        }

        private void Clean()
        {
            List<TargetDirectory> selected = new List<TargetDirectory>();
            foreach (ListViewItem item in list.CheckedItems)
            {
                TargetDirectory target = item.Tag as TargetDirectory;
                if (target != null && Directory.Exists(target.Path)) selected.Add(target);
            }
            bool fullUninstall = appCheck.Checked && appInstallation.HasAnything;
            if (selected.Count == 0 && !fullUninstall)
            {
                MessageBox.Show(this, T("没有勾选任何存在的目录，也没有勾选卸载程序本体。", "No existing folders or program uninstall option are selected."), T("CloudBox 清理", "CloudBox Cleanup"), MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string confirm = T("即将永久删除以下内容：\n\n", "The following items will be permanently deleted:\n\n");
            if (selected.Count > 0)
            {
                confirm += T("数据目录：\n", "Data folders:\n") + string.Join("\n", selected.Select(x => x.Path).ToArray()) + "\n\n";
            }
            if (fullUninstall)
            {
                confirm += T("程序本体与系统集成：\n", "Program files and system integration:\n") + AppSummary() +
                    T("\n（安装目录、快捷方式、注册表卸载项/启动项）\n\n", "\n(install folders, shortcuts, uninstall/startup registry entries)\n\n");
            }
            confirm += T("未勾选的内容不会删除。此操作不可恢复，确定继续吗？", "Unchecked items are not removed. This cannot be undone. Continue?");
            if (MessageBox.Show(this, confirm, T("确认彻底卸载", "Confirm full uninstall"), MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                return;

            if (!WarnUnsafeCustomPaths(selected)) return;
            if (!CloseCloudBox()) return;

            List<TargetDirectory> roots = RemoveNestedDuplicates(selected);
            List<string> deleted = new List<string>();
            List<string> appActions = new List<string>();
            List<string> failed = new List<string>();
            Cursor = Cursors.WaitCursor;
            try
            {
                foreach (TargetDirectory target in roots)
                {
                    if (!Directory.Exists(target.Path)) continue;
                    if (!IsSafeToDelete(target.Path, target.IsDefault))
                    {
                        failed.Add(target.Path + T("（安全校验未通过）", " (failed safety check)"));
                        continue;
                    }
                    try
                    {
                        DeleteDirectory(target.Path);
                        deleted.Add(target.Path);
                    }
                    catch (Exception ex)
                    {
                        failed.Add(target.Path + " (" + ex.Message + ")");
                    }
                }

                if (fullUninstall)
                {
                    UninstallApplication(appInstallation, appActions, failed);
                }
            }
            finally
            {
                Cursor = Cursors.Default;
            }

            RefreshLocations();
            string message = T("操作完成。\n", "Operation completed.\n");
            if (deleted.Count > 0) message += T("\n已删除数据目录：\n", "\nDeleted data folders:\n") + string.Join("\n", deleted.ToArray());
            if (appActions.Count > 0) message += T("\n\n已卸载程序/系统集成：\n", "\n\nRemoved program/system integration:\n") + string.Join("\n", appActions.ToArray());
            if (deleted.Count == 0 && appActions.Count == 0) message += T("\n未删除任何内容。", "\nNothing was deleted.");
            message += T("\n\n未处理项：未勾选的数据目录、程序本体/快捷方式/注册表项，以及其他文件。", "\n\nNot processed: unchecked data folders, program files/shortcuts/registry entries, and other files.");
            if (failed.Count > 0) message += T("\n\n未能删除：\n", "\n\nFailed to remove:\n") + string.Join("\n", failed.ToArray());
            MessageBox.Show(this, message, T("CloudBox 卸载结果", "CloudBox Uninstall Result"), MessageBoxButtons.OK, failed.Count > 0 ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }

        private bool WarnUnsafeCustomPaths(List<TargetDirectory> selected)
        {
            List<TargetDirectory> custom = selected.Where(x => !x.IsDefault).ToList();
            if (custom.Count == 0) return true;
            string warning = T("你勾选了自定义目录：\n\n", "You selected custom folders:\n\n") + string.Join("\n", custom.Select(x => x.Path).ToArray()) +
                T("\n\n这些目录可能包含你手动放置的文件。请确认它们确实是 CloudBox 的数据目录。\n\n继续删除吗？", "\n\nThese folders may contain files you placed there. Confirm they are CloudBox data folders.\n\nContinue?");
            return MessageBox.Show(this, warning, T("确认自定义目录", "Confirm custom folders"), MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }

        private bool CloseCloudBox()
        {
            Process[] processes = Process.GetProcessesByName("CloudBox");
            if (processes.Length == 0) return true;
            DialogResult close = MessageBox.Show(this, T("检测到 CloudBox 正在运行。删除前需要关闭它，是否关闭？", "CloudBox is running. Close it before deleting?"), T("CloudBox 正在运行", "CloudBox is running"), MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (close != DialogResult.Yes) return false;
            foreach (Process process in processes)
            {
                try
                {
                    process.CloseMainWindow();
                    if (!process.WaitForExit(5000)) process.Kill();
                    process.WaitForExit(3000);
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, T("无法关闭 CloudBox：", "Unable to close CloudBox: ") + ex.Message, T("CloudBox 清理", "CloudBox Cleanup"), MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return false;
                }
            }
            return true;
        }

        private static List<TargetDirectory> RemoveNestedDuplicates(List<TargetDirectory> selected)
        {
            List<TargetDirectory> ordered = selected.OrderBy(x => x.Path.Length).ToList();
            List<TargetDirectory> roots = new List<TargetDirectory>();
            foreach (TargetDirectory candidate in ordered)
            {
                bool covered = false;
                foreach (TargetDirectory parent in roots)
                {
                    if (IsSameOrChild(candidate.Path, parent.Path))
                    {
                        covered = true;
                        break;
                    }
                }
                if (!covered) roots.Add(candidate);
            }
            return roots;
        }

        private static bool IsSafeToDelete(string path, bool isDefault)
        {
            string full;
            try { full = Path.GetFullPath(path).TrimEnd('\\'); }
            catch { return false; }
            if (full.Length < 4 || full == Path.GetPathRoot(full).TrimEnd('\\')) return false;

            if (isDefault)
            {
                string leaf = Path.GetFileName(full);
                string roaming = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)).TrimEnd('\\');
                string local = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)).TrimEnd('\\');
                string parent = Path.GetDirectoryName(full);
                return string.Equals(leaf, "cloudbox", StringComparison.OrdinalIgnoreCase) &&
                    (string.Equals(parent, roaming, StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(parent, local, StringComparison.OrdinalIgnoreCase));
            }

            string windows = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.Windows)).TrimEnd('\\');
            string programFiles = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles)).TrimEnd('\\');
            string programFilesX86 = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)).TrimEnd('\\');
            string system = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.System)).TrimEnd('\\');
            string userProfile = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)).TrimEnd('\\');
            string roamingRoot = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData)).TrimEnd('\\');
            string localRoot = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)).TrimEnd('\\');
            string common = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData)).TrimEnd('\\');
            string[] protectedRoots = new[] { windows, programFiles, programFilesX86, system, userProfile, roamingRoot, localRoot, common };
            foreach (string protectedRoot in protectedRoots)
            {
                if (string.Equals(full, protectedRoot, StringComparison.OrdinalIgnoreCase)) return false;
                if (IsSameOrChild(protectedRoot, full)) return false;
            }
            return true;
        }

        private static bool IsSameOrChild(string path, string parent)
        {
            string p = Path.GetFullPath(parent).TrimEnd('\\') + "\\";
            string c = Path.GetFullPath(path).TrimEnd('\\') + "\\";
            return c.StartsWith(p, StringComparison.OrdinalIgnoreCase);
        }

        private static void DeleteDirectory(string path)
        {
            if (!Directory.Exists(path)) return;
            foreach (string entry in Directory.GetFileSystemEntries(path))
            {
                FileAttributes attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.Directory) == FileAttributes.Directory)
                {
                    if ((attributes & FileAttributes.ReparsePoint) == FileAttributes.ReparsePoint)
                    {
                        Directory.Delete(entry, false);
                    }
                    else
                    {
                        DeleteDirectory(entry);
                    }
                }
                else
                {
                    File.SetAttributes(entry, FileAttributes.Normal);
                    File.Delete(entry);
                }
            }
            File.SetAttributes(path, FileAttributes.Normal);
            Directory.Delete(path, true);
        }

        private static long GetDirectorySize(string path)
        {
            if (!Directory.Exists(path)) return 0;
            long total = 0;
            try
            {
                foreach (string file in Directory.GetFiles(path, "*", SearchOption.AllDirectories))
                {
                    try { total += new FileInfo(file).Length; } catch { }
                }
            }
            catch { }
            return total;
        }

        private static string FormatSize(long bytes)
        {
            if (bytes >= 1073741824L) return (bytes / 1073741824.0).ToString("0.0") + " GB";
            if (bytes >= 1048576L) return (bytes / 1048576.0).ToString("0.0") + " MB";
            if (bytes >= 1024L) return (bytes / 1024.0).ToString("0.0") + " KB";
            return bytes + " B";
        }

        private sealed class TargetDirectory
        {
            public readonly string Path;
            public readonly string Source;
            public readonly bool IsDefault;
            public readonly bool Checked;

            public TargetDirectory(string path, string source, bool isDefault, bool isChecked)
            {
                Path = path;
                Source = source;
                IsDefault = isDefault;
                Checked = isChecked;
            }
        }

        private sealed class RegistryEntry
        {
            public readonly RegistryHive Hive;
            public readonly RegistryView View;
            public readonly string Path;

            public RegistryEntry(RegistryHive hive, RegistryView view, string path)
            {
                Hive = hive;
                View = view;
                Path = path;
            }
        }

        private sealed class AppInstallation
        {
            public readonly List<string> InstallDirs = new List<string>();
            public readonly List<string> Shortcuts = new List<string>();
            public readonly List<RegistryEntry> RegistryEntries = new List<RegistryEntry>();
            public bool RunValue;
            public string Summary = "";

            public bool HasAnything
            {
                get { return InstallDirs.Count > 0 || Shortcuts.Count > 0 || RegistryEntries.Count > 0 || RunValue; }
            }
        }
    }
}
