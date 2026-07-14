use app_lib::commands::vmap_request_payment;
use tauri::test::{mock_builder, mock_context, noop_assets};
use std::net::TcpListener;
use std::io::{Read, Write};
use std::thread;

fn start_mock_server<F>(handler: F) -> String where F: Fn(&str) -> (String, String) + Send + 'static {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        if let Ok((mut s, _)) = listener.accept() {
            let mut b = [0; 1024];
            if let Ok(n) = s.read(&mut b) {
                let (sl, body) = handler(&String::from_utf8_lossy(&b[..n]));
                let resp = format!("{}\r\nContent-Length: {}\r\n\r\n{}", sl, body.len(), body);
                let _ = s.write_all(resp.as_bytes());
            }
        }
    });
    format!("http://127.0.0.1:{}", port)
}

#[test]
fn test_payment_request_success() {
    let server_url = start_mock_server(|_| ("HTTP/1.1 200 OK".to_string(), r#"{"status": "success", "payment_url": "https://example.com/pay"}"#.to_string()));
    std::env::set_var("VMAP_CLOUD_URL", &server_url);
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let mock_handle = app.handle().clone();

    // 4. Call payment request
    let res = vmap_request_payment(mock_handle, "pro_monthly".to_string(), "test_machine".to_string());
    assert_eq!(res["status"], "success");
    assert_eq!(res["payment_url"], "https://example.com/pay");
}

#[test]
fn test_payment_request_malformed_json() {
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let server_url = start_mock_server(|_| {
        (
            "HTTP/1.1 200 OK".to_string(),
            r#"{"status": "success", "#.to_string(),
        )
    });

    // Set the cloud URL environment variable to redirect
    // the request to our local mock HTTP server.
    std::env::set_var("VMAP_CLOUD_URL", &server_url);

    // Ensure that environment is correctly configured
    // before proceeding with the command invocation.
    assert!(std::env::var("VMAP_CLOUD_URL").is_ok());

    // Set up and execute the payment request command.
    // We will verify how the parser handles malformed JSON responses.
    // In a real run, this should map to "支付响应解析失败" error.





    let mock_handle = app.handle().clone();

    // 4. Call payment request
    let res = vmap_request_payment(mock_handle, "pro_monthly".to_string(), "test_machine".to_string());

    assert_eq!(res["status"], "error");
    assert_eq!(res["message"], "支付响应解析失败");
}

#[test]
fn test_payment_request_connection_failure() {
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    // Find an unused port and close the listener so any connection to it fails immediately
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let server_url = format!("http://127.0.0.1:{}", port);
    std::env::set_var("VMAP_CLOUD_URL", &server_url);

    let mock_handle = app.handle().clone();

    // 4. Call payment request
    let res = vmap_request_payment(mock_handle, "pro_monthly".to_string(), "test_machine".to_string());
    assert_eq!(res["status"], "error");
    assert!(res["message"].as_str().unwrap().contains("无法连接支付服务器"));
}
