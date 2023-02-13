// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict';

const imageMagick = require('imagemagick');
const Promise = require("bluebird");
const path = require('path');
const functions = require('@google-cloud/functions-framework');
const vision = require('@google-cloud/vision');
const {Storage} = require('@google-cloud/storage');
const axios = require('axios');
var fs = require('fs');

functions.cloudEvent('process-thumbnails', async (cloudEvent) => {
    console.log(`Event ID: ${cloudEvent.id}`);
    console.log(`Event Type: ${cloudEvent.type}`);

    const file = cloudEvent.data;

    try {
        console.log(`Received thumbnail request for file ${file.name} from bucket ${file.bucket}`);

        const storage = new Storage();
        const bucket = storage.bucket(file.bucket);
        const thumbBucket = storage.bucket(process.env.BUCKET_THUMBNAILS);

        const client = new vision.ImageAnnotatorClient();
        const visionRequest = {
            image: { source: { imageUri: `gs://${file.bucket}/${file.name}` } },
            features: [
                { type: 'LABEL_DETECTION' },
                {type: 'LANDMARK_DETECTION'},
                {type: 'IMAGE_PROPERTIES'},
                {type: 'OBJECT_LOCALIZATION'},
                {type: 'FACE_DETECTION'},
            ]
        };
        // We launch the vision call first so we can process the thumbnail while we wait for the response.
        const visionPromise = client.annotateImage(visionRequest);

        if (!fs.existsSync("/tmp/original")){
            fs.mkdirSync("/tmp/original");
        }
        if (!fs.existsSync("/tmp/thumbnail")){
            fs.mkdirSync("/tmp/thumbnail");
        }

        const originalFile = `/tmp/original/${file.name}`;
        const thumbFile = `/tmp/thumbnail/${file.name}`

        await bucket.file(file.name).download({
            destination: originalFile
        });

        const originalImageUrl = await bucket.file(file.name).publicUrl()

        console.log(`Downloaded picture into ${originalFile}`);

        const itemID = parseInt(path.parse(file.name).name);

        // if (isNaN(itemID)){
        //     return;
        // }

        const resizeCrop = Promise.promisify(imageMagick.crop);
        await resizeCrop({
            srcPath: originalFile,
            dstPath: thumbFile,
            width: 400,
            height: 400
        });
        console.log(`Created local thumbnail in ${thumbFile}`);

        const thumbnailImage = await thumbBucket.upload(thumbFile);
        const thumbnailImageUrl = thumbnailImage[0].publicUrl();
        console.log(`Uploaded thumbnail to Cloud Storage bucket ${process.env.BUCKET_THUMBNAILS}`);
        const visionResponse = await visionPromise;
        console.log(`Raw vision output for: ${file.name}: ${JSON.stringify(visionResponse[0])}`);

        // Addition BY EC: Upload Vision Response to thumb bucket 21 Nov 2022
        console.log(`About to upload the json file to GCS bucket`);

        const fileNameSplit = `${file.name}`.split("."); 

        // The new ID for your GCS file
        // const destFileName = 'testingfile.txt';
        const jsonDestFileName = `${fileNameSplit[0]}.json`;

        // The content to be uploaded in the GCS file
        // const contents = 'your file content';
        const jsonContents = JSON.stringify(visionResponse[0]);

        // Import Node.js stream
        const stream = require('stream');

        // Create a reference to a file object
        // const file = myBucket.file(destFileName);
        const jsonFileObj = thumbBucket.file(jsonDestFileName);

        // Create a pass through stream from a string
        const jsonPassthroughStream = new stream.PassThrough();
        jsonPassthroughStream.write(jsonContents);
        jsonPassthroughStream.end();

        // Upload json to bucket
        async function jsonStreamFileUpload() {
            jsonPassthroughStream.pipe(jsonFileObj.createWriteStream()).on('finish', () => {
            // The file upload is complete
            });
            console.log(`${jsonDestFileName} uploaded to ${thumbBucket}`);
        }
        jsonStreamFileUpload().catch(console.error);
        // End Addition by EC


        let status = "Failed"
        let labels = "";
        for (const label of visionResponse[0].labelAnnotations){
            status = label.description == "Food" ? "Ready" : status
            labels = labels.concat(label.description, ", ");
        }
        // let faces = "";
        // for (const label of visionResponse[0].faceAnnotations){
        //     faces = faces.concat(label.description, ", ");
        // }
        let landmarks = "";
        for (const label of visionResponse[0].landmarkAnnotations){
            landmarks = landmarks.concat(label.description, ", ");
        }
        let colors = "";
        for (const label of visionResponse[0].imagePropertiesAnnotation.dominantColors.colors){
            colors = colors.concat(label.color.red, ", ", label.color.green, ", ", label.color.blue, " score:", label.color.score, "pixelFraction:", label.color.pixelFraction, "; ");
        }
        let objects = "";
        for (const label of visionResponse[0].localizedObjectAnnotations){
            objects = objects.concat(label.name, ", ");
        }
        // logoAnnotations
        // textAnnotations
        // const featureList = labels.concat(landmarks, objects, "Dominant Colors per pixel fraction:", colors);
        const featureList = labels.concat(landmarks, objects);

        console.log(`\nVision API labels: ${labels}\n`);
        console.log(`\nVision API landmarks: ${landmarks}\n`);
        console.log(`\nVision API colors: ${colors}\n`);
        console.log(`\nVision API objects: ${objects}\n`);
        console.log(`\nVision API featureList: ${featureList}\n`);
        // console.log(`Menu Item status will be set to: ${status}\n`);

        // Addition BY EC: Upload Vision Response to thumb bucket 21 Nov 2022
        console.log(`About to upload the txt file to GCS bucket`);
        // The new ID for your GCS file
        const txtDestFileName = `${fileNameSplit[0]}.txt`;

        // Create a reference to a file object
        // const file = myBucket.file(destFileName);
        const txtFileObj = thumbBucket.file(txtDestFileName);

        // Create a pass through stream from a string
        const txtPassthroughStream = new stream.PassThrough();
        txtPassthroughStream.write(featureList);
        txtPassthroughStream.end();

        // Upload json to bucket
        async function txtStreamFileUpload() {
            txtPassthroughStream.pipe(txtFileObj.createWriteStream()).on('finish', () => {
            // The file upload is complete
            });
            console.log(`${txtDestFileName} uploaded to ${thumbBucket}`);
        }
        txtStreamFileUpload().catch(console.error);
        // End Addition by EC

        // const menuServer = axios.create({
        //     baseURL: process.env.MENU_SERVICE_URL,
        //     headers :{
        //         get: {
        //             "Content-Type": 'application/json'
        //         }
        //     }
        // })
        // const item = await menuServer.get(`/menu/${itemID}`);
        // Send update call to menu service
        // const request = await menuServer.put(`/menu/${itemID}`, {
        //     itemImageURL: originalImageUrl,
        //     itemName: item.data.itemName,
        //     itemPrice: item.data.itemPrice,
        //     itemThumbnailURL: thumbnailImageUrl,
        //     spiceLevel: item.data.spiceLevel,
        //     status: status,
        //     tagLine: item.data.tagLine

        // })
    } catch (err) {
        console.log(`Error: processing the thumbnail or json: ${err}`);
    }
});