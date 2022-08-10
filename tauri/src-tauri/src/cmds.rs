use crate::{
  utils::resolve::{check_installed_java, check_java_version}
};
use crate::log_if_err;
use anyhow::Result;
use crate::utils::reader_config::*;

type CmdResult<T = ()> = Result<T, String>;

/// get all profiles from `profiles.yaml`
#[tauri::command]
pub fn print_log(message: String) {
  println!("{}", message);
}

#[tauri::command]
pub fn get_config() -> CmdResult<ReaderConfig> {
  let reader_config = ReaderConfig::new();
  Ok(reader_config)
}

#[tauri::command]
pub fn save_config(config: Option<ReaderConfig>) -> CmdResult<bool> {
  let mut reader_config = ReaderConfig::new();
  if let Some(config) = config {
    log_if_err!(reader_config.patch_config(config));
  }
  Ok(true)
}

#[tauri::command]
pub fn check_java(java_path: String) -> CmdResult<String> {
  if java_path.is_empty() {
    return match check_installed_java() {
      Ok(java_path) => Ok(java_path),
      Err(err) => Err(err.to_string())
    }
  } else {
    return match check_java_version(java_path.clone()) {
      Ok(()) => Ok(java_path),
      Err(err) => Err(err.to_string())
    }
  }
}