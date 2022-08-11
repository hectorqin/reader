use crate::log_if_err;
use crate::utils::{dirs, tmpl};
use chrono::Local;
use log::LevelFilter;
use log4rs::append::console::ConsoleAppender;
use log4rs::append::file::FileAppender;
use log4rs::config::{Appender, Config, Logger, Root};
use log4rs::encode::pattern::PatternEncoder;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use tauri::PackageInfo;

/// initialize this instance's log file
fn init_log(log_dir: &PathBuf) {
  let local_time = Local::now().format("%Y-%m-%d-%H%M%S").to_string();
  let log_file = format!("{}.log", local_time);
  let log_file = log_dir.join(log_file);

  let time_format = "{d(%Y-%m-%d %H:%M:%S)} - {m}{n}";
  let stdout = ConsoleAppender::builder()
    .encoder(Box::new(PatternEncoder::new(time_format)))
    .build();
  let tofile = FileAppender::builder()
    .encoder(Box::new(PatternEncoder::new(time_format)))
    .build(log_file)
    .unwrap();

  let mut root_builder = Root::builder();
  #[cfg(debug_assertions)] {
    root_builder = root_builder.appender("stdout");
  }
  #[cfg(not(debug_assertions))] {
    root_builder = root_builder.appender("file");
  }

  let root = root_builder.build(LevelFilter::Info);

  let config = Config::builder()
    .appender(Appender::builder().build("stdout", Box::new(stdout)))
    .appender(Appender::builder().build("file", Box::new(tofile)))
    .logger(
      Logger::builder()
        .appenders(["file", "stdout"])
        .additive(false)
        .build("app", LevelFilter::Info),
    )
    .build(root)
    .unwrap();

  log4rs::init_config(config).unwrap();
}

/// Initialize all the files from resources
fn init_config(app_dir: &PathBuf) -> std::io::Result<()> {
  // target path
  let clash_path = app_dir.join("config.yaml");

  if !clash_path.exists() {
    match fs::File::create(clash_path) {
      Ok(mut f) => {
        log_if_err!(f.write(tmpl::READER_CONFIG_COMMENT.as_bytes()));
        log_if_err!(f.write(tmpl::READER_CONFIG));
      }
      Err(err) => log::error!(target: "app", "{err}")
    }
  }
  Ok(())
}

/// initialize app
pub fn init_app(package_info: &PackageInfo) {
  // create app dir
  let app_dir = dirs::app_home_dir();
  let log_dir = dirs::app_logs_dir();
  let storage_dir = dirs::app_storage_dir();

  let res_dir = dirs::app_resources_dir(package_info);

  if !app_dir.exists() {
    fs::create_dir_all(&app_dir).unwrap();
  }
  if !log_dir.exists() {
    fs::create_dir_all(&log_dir).unwrap();
  }
  if !storage_dir.exists() {
    fs::create_dir_all(&storage_dir).unwrap();
  }

  init_log(&log_dir);
  if let Err(err) = init_config(&app_dir) {
    log::error!(target: "app", "{err}");
  }

  log::info!("res_dir: {} {} {} {} {}",
    res_dir.as_os_str().to_str().unwrap().to_string(),
    res_dir.clone().into_os_string().into_string().unwrap(),
    res_dir.display(),
    res_dir.display().to_string(),
    res_dir.as_os_str().to_string_lossy().to_string()
  );

  // copy the resource file
  // let jar_path = dirs::reader_jar_path();
  // let jar_tmpl = res_dir.join("reader.jar");
  // if !jar_path.exists() && jar_tmpl.exists() {
  //   fs::copy(jar_tmpl, jar_path).unwrap();
  // }

  // copy the wintun.dll
  // #[cfg(target_os = "windows")]
  // {
  //   let wintun_path = app_dir.join("wintun.dll");
  //   let wintun_tmpl = res_dir.join("wintun.dll");
  //   if !wintun_path.exists() && wintun_tmpl.exists() {
  //     fs::copy(wintun_tmpl, wintun_path).unwrap();
  //   }
  // }
}
