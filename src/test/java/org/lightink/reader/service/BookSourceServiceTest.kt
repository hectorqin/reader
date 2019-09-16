package org.lightink.reader.service

import org.junit.Test
import org.junit.runner.RunWith
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.junit4.SpringRunner
import java.util.concurrent.CountDownLatch

/**
 * @Date: 2019-07-30 00:10
 * @Description:
 */

@RunWith(SpringRunner::class)
@SpringBootTest
class BookSourceServiceTest {

    @Autowired
    private lateinit var bookSourceService: BookSourceService

//    @Test
//    fun bookSourceRepositoryList() {
//        val countDownLatch = CountDownLatch(1)
//        bookSourceService.bookSourceRepositoryList()
//                .subscribe { t ->
//                    println(t.toString())
//                    countDownLatch.countDown()
//                }
//
//        countDownLatch.await()
//
//    }
//
//    @Test
//    fun bookSourceDescription() {
//
//
//    }
//
//    @Test
//    fun bookSource() {
//        val countDownLatch = CountDownLatch(1)
//        bookSourceService.bookSource("1212","稻草人书屋")
//                .subscribe { t ->
//                    println(t.toString())
//                    countDownLatch.countDown()
//                }
//
//        countDownLatch.await()
//
//
//    }
//
//    @Test
//    fun serverBookRepositoryJson() {
//        val countDownLatch = CountDownLatch(1)
//        bookSourceService.serverRepositoryJson()
//                .subscribe { t ->
//                    println(t.toString())
//                    countDownLatch.countDown()
//                }
//
//        countDownLatch.await()
//    }


}