package org.lightink.reader.service

import org.junit.Test
import org.junit.runner.RunWith
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.junit4.SpringRunner
import java.util.concurrent.CountDownLatch

/**
 * @Date: 2019-07-19 19:39
 * @Description:
 */
@RunWith(SpringRunner::class)
@SpringBootTest
class MainServiceTest {

    @Autowired
    private lateinit var mainService: MainService

    @Test
    fun search() {
        val countDownLatch = CountDownLatch(1)

        mainService.search("人道天堂")
                .subscribe({ t ->
                    println(t.toString())
                    countDownLatch.countDown()
                }, { e ->
                    e.printStackTrace()

                })

        countDownLatch.await()
    }

    @Test
    fun details() {


        val countDownLatch = CountDownLatch(1)

        mainService.search("人道天堂")
                .flatMap {
                    return@flatMap mainService.details(it.first()["link"]!!)
                }
                .subscribe({ t ->
                    println(t.toString())
                    countDownLatch.countDown()
                }, { e ->
                    e.printStackTrace()

                })

        countDownLatch.await()

    }


    @Test
    fun content() {

        val countDownLatch = CountDownLatch(1)

        mainService.search("人道天堂")
                .flatMap {
                    return@flatMap mainService.details(it.first()["link"]!!)
                }
                .flatMap {
                    return@flatMap mainService.content("http://www.daocaorenshuwu.com/book/rendaotiantang/585721.html")
                }
                .subscribe({ t ->
                    println(t.toString())
                    countDownLatch.countDown()
                }, { e ->
                    e.printStackTrace()

                })

        countDownLatch.await()

    }
}