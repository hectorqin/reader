use crate::log_if_err;
use crate::utils::dirs;
use crate::utils::init;
use crate::utils::help;
use crate::utils::reader_config::*;

use anyhow::{bail, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::Duration;
use tauri::api::process::{Command, CommandEvent};
use tauri::{App, Manager};
use tauri::utils::config::AppUrl;

static READER_SERVER_STARTED: AtomicBool = AtomicBool::new(false);
static READER_SERVER_FAILED: AtomicBool = AtomicBool::new(false);

/// handle something when start app
pub fn resolve_setup(app: &App) {
  // setup a simple http server for singleton
  //   server::embed_server(&app.handle());

  // init app config
  init::init_app(app.package_info());

  let reader_config = ReaderConfig::new();
  log::info!("配置文件: {:?}", reader_config);

  // create main window
  create_main_window(app, &reader_config);

  // start reader server
  start_server(app, &reader_config);
}

fn create_main_window(app: &App, config: &ReaderConfig) {
  let reader_config = Arc::new(Mutex::new(config.clone()));
  let app_handle = app.app_handle();

  let server_port = get_server_port(&config);

  let api = format!("//localhost:{}/reader3", server_port);
  let default_window_url = tauri::WindowUrl::App(format!("index.html?api={}", api).into());
  #[allow(unused_assignments)]
  let mut window_url = default_window_url.clone();

  #[cfg(debug_assertions)] {
    let build_config = app.config().build.clone();
    log::info!("app.config.build {:?}", build_config);
    let index_url = build_config.dev_path;

    window_url = match index_url {
      AppUrl::Url(dev_window_url) => match dev_window_url {
        tauri::WindowUrl::App(path) => tauri::WindowUrl::App(format!("{}?api={}", path.into_os_string().into_string().unwrap(), api).into()),
        tauri::WindowUrl::External(url) => {
          let mut new_url = url.clone();
          new_url.query_pairs_mut()
            .append_pair("api", &api);
          tauri::WindowUrl::External(new_url)
        },
        _ => default_window_url.clone()
      },
      _ => default_window_url.clone()
    };
  }

  log::info!("window_url {}", window_url);

  let mut builder =
    tauri::window::WindowBuilder::new(&app_handle, "main", window_url)
      .title("Reader")
      // .center()
      .fullscreen(false);

  let config = reader_config.lock().unwrap();

  if let Some(set_window_size) = config.set_window_size {
    if set_window_size {
      if config.width.is_some() && config.height.is_some() {
        let width = config.width.unwrap();
        let height = config.height.unwrap();
        log::info!("set size to ({}, {})", width, height);
        builder = builder.inner_size(width, height);
      }
    }
  }

  if let Some(set_window_position) = config.set_window_position {
    if set_window_position {
      if config.position_x.is_some() && config.position_y.is_some() {
        let position_x = config.position_x.unwrap();
        let position_y = config.position_y.unwrap();
        log::info!("set position to ({}, {})", position_x, position_y);
        builder = builder.position(position_x, position_y);
      }
    }
  }

  drop(config);

  match builder
    // .center()
    .decorations(true)
    // .decorations(false)
    // .transparent(true)
    .build()
  {
    Ok(window) => {
      let scale_factor = window.scale_factor().unwrap();
      window.on_window_event(move |event| match event {
        tauri::WindowEvent::Resized(size) => {
          let logical_size = size.to_logical::<f64>(scale_factor);
          log::info!("resize {:?}", logical_size);
          let mut config = reader_config.lock().unwrap();
          if let Some(remember_size) = config.remember_size {
            if remember_size {
              config.width = Some(logical_size.width);
              config.height = Some(logical_size.height);
              log_if_err!(config.save_file());
              // log_if_err!(app.emit_all("size-changed", logical_size));
            }
          }
          drop(config);
        }
        tauri::WindowEvent::Moved(position) => {
          let logical_position = position.to_logical::<f64>(scale_factor);
          log::info!("moved {:?}", logical_position);
          let mut config = reader_config.lock().unwrap();
          if let Some(remember_position) = config.remember_position {
            if remember_position {
              config.position_x = Some(logical_position.x);
              config.position_y = Some(logical_position.y);
              log_if_err!(config.save_file());
              // log_if_err!(app.emit_all("position-changed", logical_position));
            }
          }
          drop(config);
        }
        _ => {
          log::info!("event: {:?}", event);
        }
      })
    }
    Err(err) => log::error!(target: "app", "{err}"),
  }

  log::info!("main window created");
}

/// create main window
// pub fn create_window(app_handle: &AppHandle, name: &str, title: &str, url: tauri::WindowUrl) {
//   if let Some(window) = app_handle.get_window(name) {
//     let _ = window.unminimize();
//     let _ = window.show();
//     let _ = window.set_focus();
//     return;
//   }

//   log::info!("url {}", url);
//   let builder = tauri::window::WindowBuilder::new(app_handle, name, url)
//     .title(title)
//     .center()
//     .fullscreen(false);
//   // .min_inner_size(600.0, 520.0);

//   #[cfg(target_os = "windows")]
//   {
//     use crate::utils::winhelp;
//     use window_shadows::set_shadow;
//     use window_vibrancy::apply_blur;

//     match builder
//       .decorations(false)
//       .transparent(true)
//       // .inner_size(800.0, 636.0)
//       .build()
//     {
//       Ok(_) => {
//         let app_handle = app_handle.clone();

//         tauri::async_runtime::spawn(async move {
//           if let Some(window) = app_handle.get_window("main") {
//             let _ = window.show();
//             let _ = set_shadow(&window, true);

//             if !winhelp::is_win11() {
//               let _ = apply_blur(&window, None);
//             }
//           }
//         });
//       }
//       Err(err) => log::error!(target: "app", "{err}"),
//     }
//   }

//   #[cfg(target_os = "macos")]
//   crate::log_if_err!(builder
//     .decorations(true)
//     // .inner_size(800.0, 620.0)
//     .build());

//   #[cfg(target_os = "linux")]
//   crate::log_if_err!(builder
//     .decorations(false)
//     .transparent(true)
//     // .inner_size(800.0, 636.0)
//     .build());
// }

fn start_server(app: &App, reader_config: &ReaderConfig) {
  let mut java_path = String::from("");
  if let Some(java_path_config) = &reader_config.java_path {
    java_path = java_path_config.clone();
    if let Err(err) = check_java_version(java_path.clone()) {
      log::error!("check java {}", err);
      java_path = String::from("");
    }
  }
  if java_path.is_empty() {
    if let Ok(java) = check_installed_java() {
      java_path = java;
    }
  }

  if java_path.is_empty() {
  // if !java_path.is_empty() {
    if let Some(window) = &app.get_window("main") {
      log::info!("打开设置页面");
      log_if_err!(window.eval("function gotoSettingPage(){var url = window.location.origin + window.location.pathname + window.location.search + window.location.hash.replace(/^[^?]*\\??/, '#/setting?');console.log('gotoSettingPage', url);window.location.assign(url);}window.addEventListener('DOMContentLoaded', gotoSettingPage);window.addEventListener('load', gotoSettingPage);if(window.location.search){gotoSettingPage()}"));
    } else {
      log::error!("找不到主窗口...");
      return;
    }
  } else {
    // 启动 jar
    if let Err(err) = launch_server(app, java_path, reader_config) {
      log::info!("启动 reader 接口服务失败! {}", err);
      return;
    }
    log::info!("打开主窗口");
  }
}

pub fn check_installed_java() -> Result<String> {
  if let Ok(java) = which::which("java") {
    log::info!("java path {}", java.display());
    let java_path = java.into_os_string().into_string().unwrap();
    return match check_java_version(java_path.clone()) {
      Ok(()) => Ok(java_path),
      Err(err) => Err(err)
    };
  }
  bail!(format!("请安装 Java8 以上环境!"));
}

pub fn check_java_version(java_path: String) -> Result<()> {
  // let output = if cfg!(target_os = "windows") {
  //   Command::new(java.into_os_string().into_string().unwrap())
  //     .args(["-version"])
  //     .output()
  //     .expect("failed to execute process")
  // } else {
  //   Command::new(java.into_os_string().into_string().unwrap())
  //     .args(["-version"])
  //     .output()
  //     .expect("failed to execute process")
  // };
  let output =
    Command::new(java_path)
      .args(["-version"])
      .output();
  if let Err(err) = output {
    bail!(format!("请检查 java 路径 {}", err))
  }
  let output = output.unwrap();
  log::info!("output {:?}", output);
  if output.status.success() {
    log::info!("stderr {}", output.stderr);
    let result = output
      .stderr
      .split('\n')
      .collect::<Vec<_>>()
      .get(0)
      .unwrap()
      .split(' ')
      .collect::<Vec<_>>();
    // log::info!("result {:?}", result);

    let result2 = result.get(2).unwrap().split('.').collect::<Vec<_>>();
    let main_ver = result2
      .get(0)
      .unwrap()
      .replace("\"", "")
      .parse::<i32>()
      .unwrap();
    let sub_ver = result2
      .get(1)
      .unwrap()
      .replace("\"", "")
      .parse::<i32>()
      .unwrap();
    log::info!("{}", format!("main_ver: {main_ver} sub_ver: {sub_ver}"));
    if main_ver == 1 && sub_ver < 8 {
      bail!(format!("java 版本不能低于 8"))
    }
  } else {
    bail!(format!("获取 java 版本号失败，请检查 java 命令!"))
  }

  return Ok(());
}

fn launch_server(app: &App, java_path: String, reader_config: &ReaderConfig) -> Result<()> {
  let jar_path = dirs::reader_jar_path()
      .display().to_string();
  log::info!("jar path {}", jar_path);

  let args = prepare_args(jar_path, reader_config);

  tauri::async_runtime::spawn(async move {
    let (mut rx, _child) = Command::new(java_path)
      .args(args)
      .current_dir(dirs::app_home_dir())
      .spawn()
      .expect("Failed to spawn reader server");
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
          log::info!("[SERVER] {}", line);
          if let Some(_index) = line.find("Started ReaderApplication") {
            log::info!(
              "find Started ReaderApplication {} set result {}",
              _index,
              READER_SERVER_STARTED.fetch_or(true, Ordering::Relaxed)
            );
          }
        }
        CommandEvent::Terminated(payload) => {
          log::info!("Reader server exit with code {}", payload.code.unwrap_or_default());
          READER_SERVER_FAILED.fetch_or(true, Ordering::Relaxed);
          break;
        }
        CommandEvent::Error(error) => {
          log::error!("Reader server error {}", error);
        }
        _ => {}
      }
    }
  });
  wait_for_server_ready(app);
  return Ok(());
}

fn get_server_port(reader_config: &ReaderConfig) -> u64 {
  let mut server_port = 8080;
  if let Some(_server_port) = reader_config.server_port {
    server_port = _server_port;
  }
  return server_port;
}

fn prepare_args(jar_path: String, reader_config: &ReaderConfig) -> Vec<String> {
  let mut args = Vec::new();
  args.push(String::from("-jar"));
  args.push(jar_path);

  if let Some(server_config) = &reader_config.server_config {
    for item in server_config.iter() {
      if item.0.as_str() == Some("reader.app.workDir") {
        log::warn!("无效设置 reader.server.workDir");
        continue;
      }
      if item.0.as_str() == Some("reader.server.port") {
        log::warn!("请使用 serverPort 设置监听端口，reader.server.port 无效");
        continue;
      }

      if let Some(name) = item.0.as_str() {
        if item.1.is_bool() {
          args.push(format!("--{}={}", name, item.1.as_bool().unwrap()));
        } else if item.1.is_string() {
          let value = item.1.as_str().unwrap();
          if !value.is_empty() {
            args.push(format!("--{}={}", name, value));
          }
        } else if item.1.is_u64() {
          args.push(format!("--{}={}", name, item.1.as_u64().unwrap()));
        }
      }
    }
  }

  let server_port = get_server_port(&reader_config);

  if server_port > 0 {
    args.push(format!("--reader.server.port={}", server_port));
  }

  args.push(format!("--reader.app.workDir={}", dirs::app_home_dir().into_os_string().into_string().unwrap()));
  return args;
}

fn wait_for_server_ready(app: &App) {
  let start_time = help::get_now();
  loop {
    // log::info!(
    //   "READER_SERVER_STARTED {}",
    //   READER_SERVER_STARTED.load(Ordering::Relaxed)
    // );
    if READER_SERVER_FAILED.load(Ordering::Relaxed) || help::get_now() > start_time + 30 {
      log::info!(
        "reader server launch failed!!"
      );
      app.app_handle().exit(1);
    }
    if READER_SERVER_STARTED.load(Ordering::Relaxed) {
      break;
    }
    sleep(Duration::from_millis(300));
  }
}
