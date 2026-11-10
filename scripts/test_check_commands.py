import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "check_commands", Path(__file__).with_name("check-commands.py")
)
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def problems(files: dict[str, str]) -> list[str]:
    with tempfile.TemporaryDirectory() as root:
        src = Path(root)
        for name, text in files.items():
            (src / name).parent.mkdir(parents=True, exist_ok=True)
            (src / name).write_text(text)
        return check.problems_in(src)


def handler(*entries: str) -> str:
    return f"fn main() {{ tauri::generate_handler![{', '.join(entries)}]; }}"


class CheckCommands(unittest.TestCase):
    def test_a_comment_or_a_doc_line_hides_no_command(self):
        found = problems(
            {
                "main.rs": handler(),
                "bridge.rs": "#[tauri::command]\n// Reads a file.\n/// More.\npub fn hidden() {}\n",
            }
        )
        self.assertIn("bridge::hidden: a command that main.rs doesn't register", found)

    def test_async_in_the_attribute_counts_and_other_arguments_do_not(self):
        found = problems(
            {
                "main.rs": handler("bridge::a", "bridge::b", "bridge::get_settings"),
                "bridge.rs": "#[tauri::command(async)]\n#[allow(x)]\npub fn a() {}\n"
                '#[tauri::command(rename_all = "snake_case")]\npub fn b() {}\n'
                "#[tauri::command]\npub fn get_settings() {}\n",
            }
        )
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0].startswith("bridge::b: a plain command runs on the window's thread"))

    def test_any_visibility_any_module_and_a_last_entry_without_a_comma(self):
        found = problems(
            {
                "main.rs": "const X: () = bridge::NOT_A_COMMAND,;\n"
                + handler("notify::x", "bridge::get_settings"),
                "notify/mod.rs": "#[tauri::command]\npub(crate) async fn x() {}\n",
                "bridge.rs": "#[tauri::command]\nfn get_settings() {}\n",
            }
        )
        self.assertEqual(found, [])

    def test_the_same_path_twice_and_a_registration_with_no_command(self):
        found = problems(
            {
                "main.rs": handler("bridge::a", "bridge::gone"),
                "bridge.rs": "#[tauri::command]\nasync fn a() {}\n#[tauri::command]\nasync fn a() {}\n",
            }
        )
        self.assertIn("bridge::a: two commands with this path", found)
        self.assertIn("bridge::gone: registered, but no #[tauri::command] has this path", found)

    def test_the_mutants_config_lists_exactly_the_registered_commands(self):
        files = {
            "main.rs": handler("bridge::a", "bridge::get_settings", "notify::b"),
            "bridge.rs": "#[tauri::command]\nasync fn a() {}\n#[tauri::command]\nfn get_settings() {}\n",
            "notify.rs": "#[tauri::command(async)]\nfn b() {}\n",
        }
        good = check.commands_pattern({"a", "b", "get_settings"})
        self.assertEqual(problems_with_mutants(files, [good]), [])
        stale = check.commands_pattern({"a", "get_settings"})
        for patterns in ([stale], [], [good, good]):
            found = problems_with_mutants(files, patterns)
            self.assertEqual(len(found), 1, found)
            self.assertIn(good, found[0])


def problems_with_mutants(files: dict[str, str], patterns: list[str]) -> list[str]:
    with tempfile.TemporaryDirectory() as root:
        src = Path(root) / "src"
        for name, text in files.items():
            (src / name).parent.mkdir(parents=True, exist_ok=True)
            (src / name).write_text(text)
        mutants = Path(root) / "mutants.toml"
        listed = ", ".join('"' + p.replace("\\", "\\\\") + '"' for p in patterns)
        mutants.write_text(f'exclude_re = ["replace main( -> .*)? with ", {listed}]\n')
        return check.problems_in(src, mutants)


if __name__ == "__main__":
    unittest.main()
