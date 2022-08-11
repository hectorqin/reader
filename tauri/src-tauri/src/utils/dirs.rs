// use std::env::temp_dir;
use std::path::PathBuf;
use tauri::{
  api::path::{home_dir, resource_dir},
  Env, PackageInfo,
};

#[cfg(not(feature = "reader-dev"))]
static APP_DIR: &str = "reader";
#[cfg(feature = "reader-dev")]
static APP_DIR: &str = "reader-dev";

static READER_CONFIG: &str = "config.yaml";

static mut RESOURCE_DIR: Option<PathBuf> = None;

/// get the reader app home dir
pub fn app_home_dir() -> PathBuf {
  // #[cfg(target_os = "windows")]
  // unsafe {
  //   use tauri::utils::platform::current_exe;

  //   if !PORTABLE_FLAG {
  //     home_dir().unwrap().join(".config").join(APP_DIR)
  //   } else {
  //     let app_exe = current_exe().unwrap();
  //     let app_exe = dunce::canonicalize(app_exe).unwrap();
  //     let app_dir = app_exe.parent().unwrap();
  //     PathBuf::from(app_dir).join(".config").join(APP_DIR)
  //   }
  // }

  // #[cfg(not(target_os = "windows"))]
  dunce::canonicalize(home_dir().unwrap().join(".config").join(APP_DIR)).unwrap()
}

/// get the resources dir
pub fn app_resources_dir(package_info: &PackageInfo) -> PathBuf {
  let res_dir = dunce::canonicalize(resource_dir(package_info, &Env::default())
    .unwrap()
    .join("resources")).unwrap();

  unsafe {
    RESOURCE_DIR = Some(res_dir.clone());
  }

  res_dir
}

// /// profiles dir
// pub fn app_profiles_dir() -> PathBuf {
//   app_home_dir().join("profiles")
// }

/// logs dir
pub fn app_logs_dir() -> PathBuf {
  app_home_dir().join("logs")
}

/// storage dir
pub fn app_storage_dir() -> PathBuf {
  app_home_dir().join("storage")
}

pub fn config_path() -> PathBuf {
  app_home_dir().join(READER_CONFIG)
}

pub fn reader_jar_path() -> PathBuf {
  // app_home_dir().join("reader.jar")
  unsafe {
    let res_dir = RESOURCE_DIR.clone().unwrap();
    res_dir.join("reader.jar")
  }
}

// pub fn verge_path() -> PathBuf {
//   app_home_dir().join(VERGE_CONFIG)
// }

// pub fn profiles_path() -> PathBuf {
//   app_home_dir().join(PROFILE_YAML)
// }

// pub fn profiles_temp_path() -> PathBuf {
//   #[cfg(not(feature = "debug-yml"))]
//   return temp_dir().join(PROFILE_TEMP);

//   #[cfg(feature = "debug-yml")]
//   return app_home_dir().join(PROFILE_TEMP);
// }

// #[cfg(windows)]
// static SERVICE_PATH: &str = "clash-verge-service.exe";

// #[cfg(windows)]
// pub fn service_path() -> PathBuf {
//   unsafe {
//     let res_dir = RESOURCE_DIR.clone().unwrap();
//     res_dir.join(SERVICE_PATH)
//   }
// }

// #[cfg(windows)]
// pub fn service_log_file() -> PathBuf {
//   use chrono::Local;

//   let log_dir = app_logs_dir().join("service");

//   let local_time = Local::now().format("%Y-%m-%d-%H%M%S").to_string();
//   let log_file = format!("{}.log", local_time);
//   let log_file = log_dir.join(log_file);

//   std::fs::create_dir_all(&log_dir).unwrap();

//   log_file
// }