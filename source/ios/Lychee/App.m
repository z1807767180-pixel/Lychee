#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <CommonCrypto/CommonDigest.h>
#import <TargetConditionals.h>

static NSString *const Service = @"https://lychee-link-check.onrender.com";
static NSString *const Entry = @"/mobile/index.html";
typedef void (^APICompletion)(NSData *, NSInteger, NSDictionary *, NSError *);

static BOOL Local(NSURL *url) {
    return [url.scheme isEqual:@"lychee"] && [url.host isEqual:@"localhost"] &&
        !url.user && !url.password && !url.port;
}

static BOOL APIRoute(NSString *path, NSString *method) {
    BOOL read = [method isEqual:@"GET"];
    if (!(read || [method isEqual:@"POST"])) return NO;
    if ([path isEqual:@"/api/client-capabilities"]) return read;
    if ([path isEqual:@"/api/v640/account"] || [path isEqual:@"/api/v640/workspace"]) return YES;
    return [path rangeOfString:@"^/g/(legacy|[0-9a-f-]{36})/api/(for/[0-9a-f-]{36}/)?(camp|phone(/circles)?)$"
                       options:NSRegularExpressionSearch].location != NSNotFound;
}

@interface Garden : UIViewController <WKNavigationDelegate, WKUIDelegate, WKURLSchemeHandler,
        WKScriptMessageHandlerWithReply, NSURLSessionTaskDelegate, WKDownloadDelegate>
@property(nonatomic,strong) WKWebView *web;
@property(nonatomic,strong) NSURLSession *session;
@property(nonatomic,strong) NSMapTable *pending;
@property(nonatomic,strong) NSMapTable *downloads;
@end

@implementation Garden
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:.99 green:.97 blue:.92 alpha:1];
    self.pending = [NSMapTable strongToStrongObjectsMapTable];
    self.downloads = [NSMapTable strongToStrongObjectsMapTable];
    NSURLSessionConfiguration *config = [NSURLSessionConfiguration defaultSessionConfiguration];
    config.URLCache = nil;
    config.timeoutIntervalForRequest = 180;
    self.session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:NSOperationQueue.mainQueue];
    WKWebViewConfiguration *wc = [WKWebViewConfiguration new];
    [wc setURLSchemeHandler:self forURLScheme:@"lychee"];
    NSString *js = [NSString stringWithContentsOfURL:[NSBundle.mainBundle URLForResource:@"transport" withExtension:@"js"]
                                            encoding:NSUTF8StringEncoding error:nil];
    [wc.userContentController addUserScript:[[WKUserScript alloc] initWithSource:js
       injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
    [wc.userContentController addScriptMessageHandlerWithReply:self contentWorld:WKContentWorld.pageWorld name:@"lycheeAPI"];
    self.web = [[WKWebView alloc] initWithFrame:CGRectZero configuration:wc];
    self.web.navigationDelegate = self;
    self.web.UIDelegate = self;
    self.web.translatesAutoresizingMaskIntoConstraints = NO;
    self.web.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    [self.view addSubview:self.web];
    UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.web.topAnchor constraintEqualToAnchor:safe.topAnchor],
        [self.web.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor],
        [self.web.leadingAnchor constraintEqualToAnchor:safe.leadingAnchor],
        [self.web.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor]]];
    [self.web loadRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"lychee://localhost/mobile/index.html"]]];
}

- (NSURLSessionDataTask *)api:(NSURL *)local method:(NSString *)method body:(NSString *)body completion:(APICompletion)done {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:local resolvingAgainstBaseURL:NO];
    NSURLComponents *destination = [NSURLComponents componentsWithString:Service];
    destination.percentEncodedPath = parts.percentEncodedPath;
    destination.percentEncodedQuery = parts.percentEncodedQuery;
#if TARGET_OS_SIMULATOR
    if ([NSProcessInfo.processInfo.arguments containsObject:@"--offline-smoke"]) {
        BOOL probe = [local.path isEqual:@"/api/client-capabilities"];
        NSDictionary *json = probe ? @{@"protocol":@1, @"accountApi":@"v640", @"privateGardens":@YES, @"accountNotices":@YES} :
            @{@"error":@"请登录"};
        done([NSJSONSerialization dataWithJSONObject:json options:0 error:nil], probe ? 200 : 401,
             @{@"content-type":@"application/json"},nil);
        return nil;
    }
#endif
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:destination.URL];
    req.HTTPMethod = method;
    [req setValue:@"application/json, image/*, */*" forHTTPHeaderField:@"Accept"];
    if ([method isEqual:@"POST"]) {
        [req setValue:Service forHTTPHeaderField:@"Origin"];
        [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        req.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
    }
    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
        NSMutableDictionary *headers = [NSMutableDictionary dictionary];
        for (NSString *key in @[@"content-type",@"retry-after",@"x-lychee-ai-retry",@"content-disposition"]) {
            NSString *value = [http valueForHTTPHeaderField:key];
            if (value) headers[key] = value;
        }
        done(data, http.statusCode, headers, error);
    }];
    [task resume];
    return task;
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)reply
        newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion {
    completion(nil);
}

- (void)userContentController:(WKUserContentController *)controller didReceiveScriptMessage:(WKScriptMessage *)message
                 replyHandler:(void (^)(id, NSString *))reply {
    if (!message.frameInfo.mainFrame || !Local(message.frameInfo.request.URL) || ![message.frameInfo.request.URL.path isEqual:Entry] ||
        ![message.body isKindOfClass:NSDictionary.class]) {reply(nil,@"无效来源"); return;}
    NSDictionary *params = message.body;
    if ([params[@"op"] isEqual:@"sha256"] && [params[@"data"] isKindOfClass:NSString.class]) {
        NSData *input = [[NSData alloc] initWithBase64EncodedString:params[@"data"] options:0];
        if (!input || input.length > UINT32_MAX) {reply(nil,@"无效数据"); return;}
        unsigned char hash[CC_SHA256_DIGEST_LENGTH];
        CC_SHA256(input.bytes,(CC_LONG)input.length,hash);
        reply([[NSData dataWithBytes:hash length:sizeof(hash)] base64EncodedStringWithOptions:0],nil);
        return;
    }
    NSString *path = params[@"path"], *method = params[@"method"], *body = params[@"body"];
    if (![path isKindOfClass:NSString.class] || ![method isKindOfClass:NSString.class] || ![body isKindOfClass:NSString.class]) {
        reply(nil,@"无效请求"); return;
    }
    NSURL *url = [NSURL URLWithString:[@"lychee://localhost" stringByAppendingString:path]];
    if (!Local(url) || !APIRoute(url.path, method) || ([method isEqual:@"POST"] &&
        ![params[@"type"] hasPrefix:@"application/json"])) {reply(nil,@"此请求不可用"); return;}
    [self api:url method:method body:body completion:^(NSData *data, NSInteger status, NSDictionary *headers, NSError *error) {
        if (error || status < 200 || status >= 600) reply(nil,@"暂时连不上荔枝服务");
        else reply(@{@"status":@(status), @"headers":headers, @"data":[data base64EncodedStringWithOptions:0] ?: @""},nil);
    }];
}

- (void)webView:(WKWebView *)web startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSURL *url = task.request.URL;
    NSString *path = url.path;
    if (!Local(url) || ![task.request.HTTPMethod isEqual:@"GET"] ||
        [path.pathComponents containsObject:@".."] || ![path hasPrefix:@"/"]) {
        [task didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorUnsupportedURL userInfo:nil]]; return;
    }
    if (APIRoute(path,@"GET")) {
        [self.pending setObject:NSNull.null forKey:task];
        NSURLSessionDataTask *network = [self api:url method:@"GET" body:nil completion:^(NSData *data, NSInteger status, NSDictionary *headers, NSError *error) {
            if (![self.pending objectForKey:task]) return;
            [self.pending removeObjectForKey:task];
            if (error) { [task didFailWithError:error]; return; }
            [task didReceiveResponse:[[NSHTTPURLResponse alloc] initWithURL:url statusCode:status HTTPVersion:@"HTTP/1.1" headerFields:headers]];
            if (data.length) [task didReceiveData:data];
            [task didFinish];
        }];
        if (network) [self.pending setObject:network forKey:task];
        return;
    }
    NSURL *base = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"www" isDirectory:YES];
    NSURL *file = [base URLByAppendingPathComponent:[path substringFromIndex:1]].URLByStandardizingPath;
    NSData *data = [file.path hasPrefix:[base.path stringByAppendingString:@"/"]] ?
        [NSData dataWithContentsOfURL:file options:NSDataReadingMappedIfSafe error:nil] : nil;
    if (!data) { [task didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorFileDoesNotExist userInfo:nil]]; return; }
    NSDictionary *types = @{@"js":@"application/javascript", @"css":@"text/css",@"woff2":@"font/woff2",@"svg":@"image/svg+xml",@"webp":@"image/webp"};
    NSString *type = types[path.pathExtension] ?: [UTType typeWithFilenameExtension:path.pathExtension].preferredMIMEType ?: @"application/octet-stream";
    NSMutableDictionary *headers = [@{@"Content-Type":type} mutableCopy];
    if ([path isEqual:Entry]) headers[@"Content-Security-Policy"] =
        @"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' blob: data:; media-src 'self' blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    [task didReceiveResponse:[[NSHTTPURLResponse alloc] initWithURL:url statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:headers]];
    [task didReceiveData:data]; [task didFinish];
}
- (void)webView:(WKWebView *)web stopURLSchemeTask:(id<WKURLSchemeTask>)task {
    id pending = [self.pending objectForKey:task];
    [self.pending removeObjectForKey:task];
    if ([pending isKindOfClass:NSURLSessionTask.class]) [pending cancel];
}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action
       decisionHandler:(void (^)(WKNavigationActionPolicy))decide {
    NSURL *url = action.request.URL;
    if (action.shouldPerformDownload && ((Local(url) && APIRoute(url.path,@"GET")) ||
        [url.absoluteString hasPrefix:@"blob:lychee://localhost/"] || [url.absoluteString hasPrefix:@"data:image/"])) {
        decide(WKNavigationActionPolicyDownload); return;
    }
    decide(action.targetFrame.mainFrame && Local(url) && [url.path isEqual:Entry] ?
           WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)web navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download {download.delegate=self;}
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)name
 completionHandler:(void (^)(NSURL *))completion {
    NSURL *folder = [[NSURL fileURLWithPath:NSTemporaryDirectory() isDirectory:YES] URLByAppendingPathComponent:NSUUID.UUID.UUIDString];
    NSError *error = nil;
    [NSFileManager.defaultManager createDirectoryAtURL:folder withIntermediateDirectories:NO attributes:nil error:&error];
    if (error) {completion(nil); return;}
    NSURL *file = [folder URLByAppendingPathComponent:name.lastPathComponent];
    [self.downloads setObject:file forKey:download]; completion(file);
}
- (void)downloadDidFinish:(WKDownload *)download {
    NSURL *file = [self.downloads objectForKey:download];
    if (!file) return;
    [self.downloads removeObjectForKey:download];
    UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:@[file] applicationActivities:nil];
    share.popoverPresentationController.sourceView=self.view;
    share.completionWithItemsHandler = ^(UIActivityType type, BOOL completed, NSArray *items, NSError *error) {
        [NSFileManager.defaultManager removeItemAtURL:file.URLByDeletingLastPathComponent error:nil];
    };
    [self presentViewController:share animated:YES completion:nil];
}
- (void)download:(WKDownload *)download didFailWithError:(NSError *)error resumeData:(NSData *)data {
    NSURL *file=[self.downloads objectForKey:download];
    if(file) [NSFileManager.defaultManager removeItemAtURL:file.URLByDeletingLastPathComponent error:nil];
    [self.downloads removeObjectForKey:download];
}
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)web { [web reload]; }
#if TARGET_OS_SIMULATOR
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
    if (![NSProcessInfo.processInfo.arguments containsObject:@"--offline-smoke"]) return;
    [self checkLoginAfterLoad:30];
}
- (void)checkLoginAfterLoad:(NSInteger)remaining {
    NSString *script = @"document.body.dataset.clientBuild === '6.4.7' && !!document.querySelector('.garden-access input') && !document.querySelector('#lychee-launch') && typeof crypto.randomUUID === 'function' && !!crypto.subtle";
    [self.web evaluateJavaScript:script completionHandler:^(id ok, NSError *error) {
        if ([ok boolValue]) {
            NSString *doc = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject;
            [@"6.4.7" writeToFile:[doc stringByAppendingPathComponent:@"smoke.ok"] atomically:YES encoding:NSUTF8StringEncoding error:nil];
        } else if (remaining>0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),dispatch_get_main_queue(),^{[self checkLoginAfterLoad:remaining-1];});
    }];
}
#endif
@end

@interface App : UIResponder <UIApplicationDelegate>
@property(nonatomic,strong) UIWindow *window;
@end
@implementation App
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = [Garden new];
    [self.window makeKeyAndVisible];
    return YES;
}
@end
int main(int argc,char **argv) {
    @autoreleasepool {return UIApplicationMain(argc,argv,nil,NSStringFromClass(App.class));}
}
