import asyncio
import threading
import time
import sys
import os
import unittest

# Ensure the root directory is in python path
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from backend.app import separation_tasks, separation_tasks_lock, get_separation_task

class TestSeparationConcurrency(unittest.TestCase):
    def test_concurrent_read_write(self):
        task_id = "test_concurrent_task"
        
        # Initialize task
        with separation_tasks_lock:
            separation_tasks[task_id] = {"status": "processing", "progress": 0, "status_text": "Starting"}
            
        num_iterations = 500
        errors = []

        def writer_thread():
            try:
                for i in range(num_iterations):
                    with separation_tasks_lock:
                        separation_tasks[task_id]["progress"] = i % 100
                        separation_tasks[task_id]["status_text"] = f"Processing chunk {i}"
                    time.sleep(0.001)
            except Exception as e:
                errors.append(f"Writer error: {e}")

        def reader_thread():
            try:
                for i in range(num_iterations):
                    # We can call get_separation_task directly, but it's an async function.
                    # Since we are in a thread without an event loop running, we can run it using asyncio.run
                    # or we can check the dict directly using the lock.
                    # Let's test calling the async function via asyncio.run
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    task_res = loop.run_until_complete(get_separation_task(task_id))
                    loop.close()
                    
                    # Verify task_res contents
                    self.assertIn("status", task_res)
                    self.assertIn("progress", task_res)
                    self.assertIn("status_text", task_res)
                    self.assertEqual(task_res["status"], "processing")
                    time.sleep(0.001)
            except Exception as e:
                errors.append(f"Reader error: {e}")

        # Start concurrent threads
        threads = [
            threading.Thread(target=writer_thread),
            threading.Thread(target=reader_thread),
            threading.Thread(target=reader_thread),
        ]
        
        for t in threads:
            t.start()
            
        for t in threads:
            t.join()

        self.assertEqual(errors, [], f"Concurrency errors encountered: {errors}")
        print("[OK] Concurrency test passed with zero errors under concurrent read/write.")

if __name__ == "__main__":
    unittest.main()
