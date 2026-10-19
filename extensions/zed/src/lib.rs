use serde::{Deserialize, Serialize};
use std::env;
use zed::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const SERVER_ID: &str = "mcp-server-mrscraper";
const PACKAGE_NAME: &str = "@mrscraper/mcp";
const PACKAGE_VERSION: &str = "0.2.1";
const SERVER_PATH: &str = "node_modules/@mrscraper/mcp/dist/bin.js";
const MISSING_KEY: &str = "Set context_servers.mcp-server-mrscraper.settings.api_key in your Zed user settings. Get a key at https://app.mrscraper.com/api-tokens.";

struct MrScraperExtension;

#[derive(Deserialize, Serialize)]
struct MrScraperSettings {
    api_key: String,
}

fn parse_settings(value: Option<serde_json::Value>) -> Result<MrScraperSettings> {
    let mut settings: MrScraperSettings =
        serde_json::from_value(value.ok_or_else(|| MISSING_KEY.to_string())?)
            .map_err(|_| MISSING_KEY.to_string())?;
    settings.api_key = settings.api_key.trim().to_string();
    if settings.api_key.is_empty() || settings.api_key == "YOUR_MRSCRAPER_API_KEY" {
        return Err(MISSING_KEY.to_string());
    }
    Ok(settings)
}

fn server_environment(settings: MrScraperSettings) -> Vec<(String, String)> {
    vec![
        ("MRSCRAPER_API_KEY".into(), settings.api_key),
        ("TRANSPORT".into(), "stdio".into()),
    ]
}

fn check_server_id(context_server_id: &ContextServerId) -> Result<()> {
    if context_server_id.as_ref() != SERVER_ID {
        return Err("Unknown MrScraper context server ID.".into());
    }
    Ok(())
}

impl zed::Extension for MrScraperExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        check_server_id(context_server_id)?;
        let settings = ContextServerSettings::for_project(SERVER_ID, project)?;
        let settings = parse_settings(settings.settings)?;

        if zed::npm_package_installed_version(PACKAGE_NAME)?.as_deref() != Some(PACKAGE_VERSION) {
            zed::npm_install_package(PACKAGE_NAME, PACKAGE_VERSION)?;
        }

        let server_path = env::current_dir()
            .map_err(|_| "Could not locate the MrScraper extension directory.".to_string())?
            .join(SERVER_PATH);

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![server_path.to_string_lossy().into_owned()],
            env: server_environment(settings),
        })
    }

    fn context_server_configuration(
        &mut self,
        context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        check_server_id(context_server_id)?;
        let current_settings = ContextServerSettings::for_project(SERVER_ID, project)?;
        let default_settings = match parse_settings(current_settings.settings) {
            Ok(settings) => serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?,
            Err(_) => include_str!("../configuration/default_settings.json").to_string(),
        };

        Ok(Some(ContextServerConfiguration {
            installation_instructions: include_str!(
                "../configuration/installation_instructions.md"
            )
            .to_string(),
            default_settings,
            settings_schema: include_str!("../configuration/settings_schema.json").to_string(),
        }))
    }
}

zed::register_extension!(MrScraperExtension);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_missing_invalid_and_placeholder_credentials_without_echoing_them() {
        for value in [
            None,
            Some(json!({})),
            Some(json!({"api_key": 123})),
            Some(json!({"api_key": "  "})),
            Some(json!({"api_key": "YOUR_MRSCRAPER_API_KEY"})),
        ] {
            assert_eq!(parse_settings(value).err().as_deref(), Some(MISSING_KEY));
        }
    }

    #[test]
    fn settings_round_trip_json_special_characters() {
        let key = "test-key-\"with\\special\ncharacters";
        let settings = parse_settings(Some(json!({"api_key": key}))).unwrap();
        let serialized = serde_json::to_string_pretty(&settings).unwrap();
        let restored: MrScraperSettings = serde_json::from_str(&serialized).unwrap();
        assert_eq!(restored.api_key, key);
    }

    #[test]
    fn launches_stdio_with_the_configured_trimmed_credential() {
        let settings = parse_settings(Some(json!({"api_key": " test-key "}))).unwrap();
        let environment = server_environment(settings);
        assert!(environment.contains(&("MRSCRAPER_API_KEY".into(), "test-key".into())));
        assert!(environment.contains(&("TRANSPORT".into(), "stdio".into())));
    }
}
