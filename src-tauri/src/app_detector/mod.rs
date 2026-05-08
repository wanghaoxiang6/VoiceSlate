use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::sync::{Mutex, OnceLock};

use crate::llm::AppType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppContext {
    pub app_name: String,
    pub window_title: String,
    pub app_type: AppType,
    #[serde(skip)]
    pub process_id: u32,
    #[serde(skip)]
    pub window_handle: isize,
}

impl Default for AppContext {
    fn default() -> Self {
        Self {
            app_name: String::new(),
            window_title: String::new(),
            app_type: AppType::General,
            process_id: 0,
            window_handle: 0,
        }
    }
}

#[cfg(target_os = "windows")]
static LAST_EXTERNAL_APP: OnceLock<Mutex<Option<AppContext>>> = OnceLock::new();

#[cfg(target_os = "windows")]
fn last_external_app() -> &'static Mutex<Option<AppContext>> {
    LAST_EXTERNAL_APP.get_or_init(|| Mutex::new(None))
}

pub fn detect_current_app() -> AppContext {
    #[cfg(target_os = "windows")]
    {
        windows_detect()
    }
    #[cfg(target_os = "macos")]
    {
        macos_detect()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        AppContext::default()
    }
}

pub fn is_self_app(app_name: &str) -> bool {
    let lowered = app_name.to_lowercase();
    lowered.contains("opentypeless")
        || lowered.contains("opentypeless-local")
        || lowered.contains("voiceslate")
        || lowered.contains("voiceslate-local")
        || lowered.contains("open typeless")
}

#[cfg(target_os = "macos")]
fn macos_detect() -> AppContext {
    use std::process::Command;

    let app_name = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to get name of first application process whose frontmost is true"#,
        ])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let window_title = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events"
            set frontApp to first application process whose frontmost is true
            try
                get name of front window of frontApp
            on error
                return ""
            end try
        end tell"#,
        ])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let app_type = classify_app(&app_name);
    AppContext {
        app_name,
        window_title,
        app_type,
        process_id: 0,
        window_handle: 0,
    }
}

#[cfg(target_os = "windows")]
fn windows_detect() -> AppContext {
    let current = windows_detect_raw();
    if !is_self_app(&current.app_name) && current.window_handle != 0 {
        *last_external_app().lock().unwrap_or_else(|e| e.into_inner()) = Some(current.clone());
        return current;
    }

    if let Some(prev) = last_external_app()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
    {
        return prev;
    }

    current
}

#[cfg(target_os = "windows")]
fn windows_detect_raw() -> AppContext {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    unsafe {
        let hwnd = windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow();
        if hwnd.is_null() {
            return AppContext::default();
        }

        let mut title_buf = [0u16; 512];
        let len = windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextW(
            hwnd,
            title_buf.as_mut_ptr(),
            title_buf.len() as i32,
        );
        let window_title = if len > 0 {
            OsString::from_wide(&title_buf[..len as usize])
                .to_string_lossy()
                .to_string()
        } else {
            String::new()
        };

        let mut pid = 0u32;
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, &mut pid);

        let app_name = get_process_name(pid).unwrap_or_default();
        let app_type = classify_app(&app_name);

        AppContext {
            app_name,
            window_title,
            app_type,
            process_id: pid,
            window_handle: hwnd as isize,
        }
    }
}

#[cfg(target_os = "windows")]
pub fn refresh_last_external_app() {
    let current = windows_detect_raw();
    if !is_self_app(&current.app_name) && current.window_handle != 0 {
        *last_external_app().lock().unwrap_or_else(|e| e.into_inner()) = Some(current);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn refresh_last_external_app() {}

#[cfg(target_os = "windows")]
pub fn focus_app_window(ctx: &AppContext) -> bool {
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, IsIconic, IsWindow, IsWindowVisible, SetForegroundWindow, ShowWindow,
            SW_RESTORE, SW_SHOW,
        };

        if ctx.window_handle == 0 {
            return false;
        }
        let hwnd = ctx.window_handle as windows_sys::Win32::Foundation::HWND;
        if IsWindow(hwnd) == 0 {
            return false;
        }

        // Only restore when the target is actually minimized.
        // Calling SW_RESTORE on a maximized window can shrink it back to normal size.
        if IsIconic(hwnd) != 0 {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else if IsWindowVisible(hwnd) == 0 {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }

        let _ = BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd) != 0
    }
}

#[cfg(not(target_os = "windows"))]
pub fn focus_app_window(_ctx: &AppContext) -> bool {
    false
}

#[cfg(target_os = "windows")]
unsafe fn get_process_name(pid: u32) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    if pid == 0 {
        return None;
    }

    let handle = windows_sys::Win32::System::Threading::OpenProcess(
        windows_sys::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
        0,
        pid,
    );
    if handle.is_null() {
        return None;
    }

    let mut buf = [0u16; 260];
    let mut size = buf.len() as u32;
    let ok = windows_sys::Win32::System::Threading::QueryFullProcessImageNameW(
        handle,
        0,
        buf.as_mut_ptr(),
        &mut size,
    );
    let _ = windows_sys::Win32::Foundation::CloseHandle(handle);

    if ok != 0 && size > 0 {
        let path = OsString::from_wide(&buf[..size as usize])
            .to_string_lossy()
            .to_string();
        path.rsplit('\\').next().map(|s| s.to_string())
    } else {
        None
    }
}

#[allow(dead_code)]
fn classify_app(app_name: &str) -> AppType {
    let name = app_name.to_lowercase();
    if ["outlook", "gmail", "thunderbird", "mail"]
        .iter()
        .any(|k| name.contains(k))
    {
        AppType::Email
    } else if ["slack", "discord", "wechat", "telegram", "teams"]
        .iter()
        .any(|k| name.contains(k))
    {
        AppType::Chat
    } else if ["code", "codex", "intellij", "vim", "nvim", "cursor"]
        .iter()
        .any(|k| name.contains(k))
    {
        AppType::Code
    } else if ["word", "docs", "notion", "obsidian", "typora"]
        .iter()
        .any(|k| name.contains(k))
    {
        AppType::Document
    } else {
        AppType::General
    }
}
