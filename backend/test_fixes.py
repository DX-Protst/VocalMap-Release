import unittest
import os
import re

class TestFixes(unittest.TestCase):
    def setUp(self):
        self.root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    def test_r1_workspace_pro_html(self):
        file_path = os.path.join(self.root_dir, 'frontend', 'src', 'components', 'workspace_pro.html')
        self.assertTrue(os.path.exists(file_path), f"{file_path} does not exist")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Left column check
        left_match = re.search(
            r'<!--\s*左半部分:\s*6-Stem\s*乐器分离\s*-->\s*<div\s+class="glass-panel"\s+style="flex:\s*1;\s*display:\s*flex;\s*flex-direction:\s*column;\s*overflow:\s*hidden;">',
            content
        )
        self.assertIsNotNone(left_match, "Left column wrapper class or style is incorrect in workspace_pro.html")
        
        # Right column check
        right_match = re.search(
            r'<!--\s*右半部分:\s*主唱与和声分离\s*-->\s*<div\s+class="glass-panel"\s+style="flex:\s*1;\s*display:\s*flex;\s*flex-direction:\s*column;\s*overflow:\s*hidden;">',
            content
        )
        self.assertIsNotNone(right_match, "Right column wrapper class or style is incorrect in workspace_pro.html")

    def test_r1_mouse_coordinate_tracking(self):
        file_path = os.path.join(self.root_dir, 'frontend', 'js', 'updater_settings.js')
        self.assertTrue(os.path.exists(file_path), f"{file_path} does not exist")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        self.assertIn('updateGlassPanels', content, "updateGlassPanels function missing in updater_settings.js")
        self.assertIn("document.addEventListener('scroll'", content, "scroll event listener missing in updater_settings.js")

    def test_r2_format_conversion_fetch_error(self):
        file_path = os.path.join(self.root_dir, 'frontend', 'js', 'separation.js')
        self.assertTrue(os.path.exists(file_path), f"{file_path} does not exist")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        # Verify fetch to /api/convert/process includes X-VocalMap-Token header
        self.assertIn("'/api/convert/process'", content, "/api/convert/process fetch endpoint missing")
        self.assertIn("'X-VocalMap-Token': window.internalApiToken", content, "X-VocalMap-Token header missing in separation.js")

    def test_r3_subprocess_buffering(self):
        file_path = os.path.join(self.root_dir, 'backend', 'separation.py')
        self.assertTrue(os.path.exists(file_path), f"{file_path} does not exist")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        self.assertIn("bufsize=0", content, "bufsize=0 not found in separation.py subprocess call")

    def test_r3_callback_signature(self):
        file_path = os.path.join(self.root_dir, 'backend', 'app.py')
        self.assertTrue(os.path.exists(file_path), f"{file_path} does not exist")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        self.assertIn("def update_progress(p: int, text: str = None, **kwargs)", content, 
                      "update_progress signature must accept **kwargs")
        self.assertIn('kwargs.get("log")', content, 
                      "update_progress must fall back to kwargs.get('log')")

    def test_r3_tqdm_disable_false(self):
        file_path_1 = os.path.join(self.root_dir, 'logic_bsroformer', 'inference.py')
        file_path_2 = os.path.join(self.root_dir, 'logic_bsroformer', 'utils', 'model_utils.py')
        
        self.assertTrue(os.path.exists(file_path_1), f"{file_path_1} does not exist")
        self.assertTrue(os.path.exists(file_path_2), f"{file_path_2} does not exist")
        
        with open(file_path_1, 'r', encoding='utf-8') as f:
            content_1 = f.read()
        with open(file_path_2, 'r', encoding='utf-8') as f:
            content_2 = f.read()
            
        self.assertIn('disable=False', content_1, "disable=False not specified for tqdm in logic_bsroformer/inference.py")
        self.assertIn('disable=False', content_2, "disable=False not specified for tqdm in logic_bsroformer/utils/model_utils.py")

    def test_compiled_index_html(self):
        file_path = os.path.join(self.root_dir, 'frontend', 'index.html')
        self.assertTrue(os.path.exists(file_path), f"{file_path} does not exist")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        self.assertIn('class="glass-panel" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;"', content)

    def test_r2_thread_safety_lock_exists(self):
        # Static check
        app_path = os.path.join(self.root_dir, 'backend', 'app.py')
        self.assertTrue(os.path.exists(app_path))
        with open(app_path, 'r', encoding='utf-8') as f:
            content = f.read()
        self.assertIn("separation_tasks_lock = threading.Lock()", content)
        self.assertIn("with separation_tasks_lock:", content)

        # Import check
        import sys
        if self.root_dir not in sys.path:
            sys.path.insert(0, self.root_dir)
        from backend.app import separation_tasks_lock
        import threading
        self.assertIsInstance(separation_tasks_lock, type(threading.Lock()))

    def test_r2_no_karaoke_path_swap(self):
        app_path = os.path.join(self.root_dir, 'backend', 'app.py')
        with open(app_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Verify the swap code is not in export_tmap and export_vmap
        self.assertNotIn("vocals_path, inst_path = inst_path, vocals_path", content)

if __name__ == '__main__':
    unittest.main()
