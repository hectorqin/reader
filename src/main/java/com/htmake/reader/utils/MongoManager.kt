package com.htmake.reader.utils;

// import com.mongodb.MongoClientSettings;
import com.mongodb.MongoException;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.MongoCollection;
import com.htmake.reader.entity.MongoFile
import org.bson.codecs.pojo.PojoCodecProvider
import com.mongodb.MongoClientSettings.getDefaultCodecRegistry;
import org.bson.codecs.configuration.CodecRegistries.fromProviders;
import org.bson.codecs.configuration.CodecRegistries.fromRegistries;

object MongoManager {
    private lateinit var mongoClient: MongoClient

    fun isInit(): Boolean {
        return ::mongoClient.isInitialized
    }

    fun connect(uri: String) {
        try {
            mongoClient = MongoClients.create(uri)
        } catch (e: MongoException) {
            logger.info("mongodb 连接失败，请检查链接({})是否正确", uri)
            e.printStackTrace()
        }
    }

    fun db(db: String): MongoDatabase? {
        if (!isInit()) {
            return null
        }
        val pojoCodecProvider = PojoCodecProvider.builder().automatic(true).build();
        val pojoCodecRegistry = fromRegistries(getDefaultCodecRegistry(), fromProviders(pojoCodecProvider));
        return mongoClient.getDatabase(db).withCodecRegistry(pojoCodecRegistry);
    }

    fun fileStorage(db: String, collection: String): MongoCollection<MongoFile>? {
        return db(db)?.getCollection(collection, MongoFile::class.java)
    }
}