package io.legado.app.help.http

import io.vertx.core.http.HttpClientOptions
import okhttp3.*
import okhttp3.ConnectionSpec
import okhttp3.logging.HttpLoggingInterceptor
import org.lightink.reader.ReaderApplication
import retrofit2.Retrofit
import java.util.*
import java.util.concurrent.TimeUnit
import java.net.Proxy
import java.net.InetSocketAddress
import java.io.IOException
import okhttp3.Authenticator
import okhttp3.Credentials


object HttpHelper {

    val client: OkHttpClient by lazy {
        val default = ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS)
                .tlsVersions(TlsVersion.TLS_1_2)
                .build()

        val specs = ArrayList<ConnectionSpec>()
        specs.add(default)
        specs.add(ConnectionSpec.COMPATIBLE_TLS)
        specs.add(ConnectionSpec.CLEARTEXT)

        val dispatcher = Dispatcher()
        dispatcher.maxRequests = 200
        dispatcher.maxRequestsPerHost = 200
        val logging = HttpLoggingInterceptor()
        // logging.level = HttpLoggingInterceptor.Level.BODY

        val builder = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .sslSocketFactory(SSLHelper.unsafeSSLSocketFactory, SSLHelper.unsafeTrustManager)
                .retryOnConnectionFailure(true)
                .hostnameVerifier(SSLHelper.unsafeHostnameVerifier)
                .connectionSpecs(specs)
                .followRedirects(true)
                .followSslRedirects(true)
                .protocols(listOf(Protocol.HTTP_1_1))
                .dispatcher(dispatcher)
                .addInterceptor(getHeaderInterceptor())
                .addInterceptor(logging)

        // 支持代理设置
        val enableProxy = System.getProperty("reader.app.proxy")
        val proxyHost = System.getProperty("reader.app.proxyHost")
        val proxyPort = System.getProperty("reader.app.proxyPort")
        if (
            enableProxy != null && enableProxy.isNotEmpty() && enableProxy != "false" &&
            proxyHost != null && proxyHost.isNotEmpty() &&
            proxyPort != null && proxyPort.isNotEmpty()
        ) {
            try {
                val port = proxyPort.toInt()
                if (port > 0) {
                    //代理服务器的IP和端口号
                    var proxyType = System.getProperty("reader.app.proxyType")
                    var type = Proxy.Type.HTTP
                    try {
                        if (proxyType != null && proxyType.isNotEmpty()) {
                            type = Proxy.Type.valueOf(proxyType.toUpperCase())
                        }
                    } catch(e: Exception) {
                        e.printStackTrace()
                    }
                    builder.proxy(Proxy(type, InetSocketAddress(proxyHost, port)));
                    var proxyUsername = System.getProperty("reader.app.proxyUsername")
                    var proxyPassword = System.getProperty("reader.app.proxyPassword")
                    if (
                        proxyUsername != null && proxyUsername.isNotEmpty() &&
                        proxyPassword != null && proxyPassword.isNotEmpty()
                    ) {
                        val proxyAuthenticator = object: Authenticator {
                            @Throws(IOException::class)
                            override fun authenticate(route: Route?, response: Response): Request {
                                //设置代理服务器账号密码
                                val credential = Credentials.basic(proxyUsername, proxyPassword);
                                return response.request.newBuilder()
                                       .header("Proxy-Authorization", credential)
                                       .build();
                            }
                        }
                        builder.proxyAuthenticator(proxyAuthenticator);
                    }
                }
            } catch(e: Exception) {
                e.printStackTrace()
            }
        }

        builder.build()
    }

    val rxClient by lazy {
        val httpClient = ReaderApplication.vertx.createHttpClient(
                HttpClientOptions()
                        .setMaxPoolSize(1000)
        )
        httpClient
    }

    inline fun <reified T> getApiService(baseUrl: String): T {
        return getRetrofit(baseUrl).create(T::class.java)
    }

    inline fun <reified T> getApiService(baseUrl: String, encode: String): T {
        return getRetrofit(baseUrl, encode).create(T::class.java)
    }

    fun getRetrofit(baseUrl: String, encode: String? = null): Retrofit {
        return Retrofit.Builder().baseUrl(baseUrl)
                //增加返回值为字符串的支持(以实体类返回)
                .addConverterFactory(EncodeConverter(encode))
                //增加返回值为Observable<T>的支持
//                .callFactory(VertxCallFactory(rxClient))
                .addCallAdapterFactory(CoroutinesCallAdapterFactory.create())
                .client(client)
                .build()
    }

    fun getByteRetrofit(baseUrl: String): Retrofit {
        return Retrofit.Builder().baseUrl(baseUrl)
                .addConverterFactory(ByteConverter())
                //增加返回值为Observable<T>的支持
                .addCallAdapterFactory(CoroutinesCallAdapterFactory.create())
                .client(client)
                .build()
    }

    private fun getHeaderInterceptor(): Interceptor {
        return Interceptor { chain ->
            val request = chain.request()
                    .newBuilder()
                    .addHeader("Keep-Alive", "300")
                    .addHeader("Connection", "Keep-Alive")
                    .addHeader("Cache-Control", "no-cache")
                    .build()
            chain.proceed(request)
        }
    }

//    suspend fun ajax(params: AjaxWebView.AjaxParams): Res =
//        suspendCancellableCoroutine { block ->
//            val webView = AjaxWebView()
//            block.invokeOnCancellation {
//                webView.destroyWebView()
//            }
//            webView.callback = object : AjaxWebView.Callback() {
//                override fun onResult(response: Res) {
//                    if (!block.isCompleted)
//                        block.resume(response)
//                }
//
//                override fun onError(error: Throwable) {
//                    if (!block.isCompleted)
//                        block.resume(Res(params.url, error.localizedMessage))
//                }
//            }
//            webView.load(params)
//        }

}