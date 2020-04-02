const express=require('express');
const url=require('url');
const querystring=require('querystring');
const bodyParser = require('body-parser');
const request=require('request');
const IgniteClient = require('apache-ignite-client');
const SqlFieldsQuery = IgniteClient.SqlFieldsQuery;
const IgniteClientConfiguration = IgniteClient.IgniteClientConfiguration;
const ENDPOINT='172.30.197.5';// '172.30.197.6';'127.0.0.1','10.65.107.71'
const CACHE_NAME='NAVHistoryCache';
var _ = require('underscore');
const {numformatfn}=require('./NumberFormatFn');
const dataForge=require('data-forge');
const dateFormat = require('dateformat');
const morgan=require('morgan');
const pagecount=10000;

const app=express();
app.use(morgan('dev'));



app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json());

app.use(function(req,res,next){
    const queryparametre=req.query;
    if(Object.keys(queryparametre).length!=7
    ||!queryparametre.hasOwnProperty("fundid")
    ||!queryparametre.hasOwnProperty("shareclasscode")
    ||!queryparametre.hasOwnProperty("countrycode")
    ||!queryparametre.hasOwnProperty("languagecode")
    ||!queryparametre.hasOwnProperty("begindate")
    ||!queryparametre.hasOwnProperty("enddate")
    ||!queryparametre.hasOwnProperty("pageno")
    ||!req.accepts('application/json')

      ){
           res.status(400)
           .json({Error: "Invalid  query parametres.Accepts pageno,countrycode,languagecode,fundid,shareclasscode,begindate and enddate as query params and accept header should be application/json"})
      }
     else{
         next();
     }


});


const objprpchk=function(obj,attr){

    if(obj!=undefined){
        if(obj.hasOwnProperty(attr)){
                return obj[attr]
        }
        else{
              return null
        }
    }else{
        return null
    }
};

const func2=async function(QueryString,queryparams,Canonical,args){
    const starttime = new Date();
    const igniteClient =await new IgniteClient();


    try {
        console.log("Func2 StartTime for canonical: "+Canonical+" "+starttime.toJSON());
        await igniteClient.connect(new IgniteClientConfiguration(ENDPOINT));
        const cache =igniteClient.getCache(CACHE_NAME);
        let query=new SqlFieldsQuery(QueryString).setArgs(...queryparams);
        query.setIncludeFieldNames(true);
        const cursor =await cache.query(query);

        console.log("CursorCreated for canonical: "+Canonical+" "+new Date().toJSON());
        const data = await cursor.getAll();
        console.log("DataFetched for canonical: "+Canonical+" "+new Date().toJSON());
        const fields=cursor.getFieldNames();
        console.log("Field names fetched  for canonical "+Canonical+" "+new Date().toJSON());

        const res_data=await  (new dataForge.DataFrame({
            columnNames:fields,
            rows:data
                })).toJSON();

        console.log("Columns and Data Mapped for canonical "+Canonical+" "+new Date().toJSON());

        let res_data_final=JSON.parse(res_data);
        let res_data_sorted;
        let pageobj={};

        let cnt_rec=res_data_final.length;

        if (Canonical=="NumberandDateFormat" || Canonical=="NAVstartrowid" ){
             res_data_sorted=res_data_final;
          }
        else if(cnt_rec>0){

             const startposition=args.pageno==1 ? 0 : (pagecount*(args.pageno-1));
             const endposition=args.pageno==1 ?  pagecount : (pagecount*(args.pageno));

             res_data_sorted=await (_.sortBy(res_data_final,'FUND_SHCL_CNT_LNG_RNK')).slice(startposition,endposition);
             pageobj.hasnextpage= cnt_rec>pagecount ? true : false;
             pageobj.totalrecords=cnt_rec;
             pageobj.currentpagerecordcount=res_data_sorted.length;
             pageobj.totalpages=Math.ceil(cnt_rec/pagecount);
             pageobj.perpagelimit=pagecount;

        }
        else{
            res_data_sorted=[];
        }

        console.log("Data Frame is converted to JS Native Object for canonical "+Canonical+" "+new Date().toJSON());


        const endtime = new Date();
        console.log("Func2 execution for canonical "+Canonical+" completed in  "+(endtime.getTime()-starttime.getTime())+" milliseconds");

        return  Promise.resolve([res_data_sorted,pageobj]);



    }


finally {

    console.log("Func2 execution Completed for canonical "+Canonical+" "+new Date().toJSON());
    igniteClient.disconnect();

}
}



app.get('/NAVHistoryData',async function(req,res,next){

    try {

        const starttime = new Date();
        console.log("Data Generation Started at "+starttime.toJSON());
        const args=req.query;
        const queryNAVHistory=`SELECT DISTINCT

        FUNDID,
        NAVEFFECTIVE_DATE,
        NAV,
        NAV_CHANGE_VALUE,
        AS_OF_DATE_ORDER,
        CURRENCY_CODE,
        DAILY_NAV_CHANGE_PERCENTAGE,
        APPLICATION_PRICE,
        REDEMPTION_PRICE,
        NAV_DATE_STD,
        REINVESTED_NAV,
        FUND_SHCL_CNT_LNG_RNK
        FROM Pie.NAVHistory
        WHERE

        FUNDID=?
        AND SHARE_CLASS_CODE=?
        AND AS_OF_DATE>=? AND AS_OF_DATE<=?


        `;



        const queryNumberandDateFormat=`select
        LANGUAGE_CODE,
        COUNTRY_CODE,
        LABEL_CATEGORY,
        FMT_CODE,
        FMT_DCML_SEP,
        FMT_THOUSAND_SEP,
        FMT_SYMBL,
        FMT_RNDNG,
        FMT_DATE,
        FMT_PRFX_SUFX


        from

        PIE.NumberandDateFormat

        where COUNTRY_CODE=? and LANGUAGE_CODE=? AND LABEL_CATEGORY IN (?,?,?,?)
        `;


    let results=await Promise.all(
            [
             func2(queryNAVHistory,[args.fundid,args.shareclasscode,args.begindate,args.enddate
                   ],"NAVHistory",args),
             func2(queryNumberandDateFormat,[args.countrycode,args.languagecode,'PRICE','CURRENCY_SYMBOL','NAV_CHANGE_PERCENT','AS_OF_DATE'],"NumberandDateFormat",args),

           ])//.catch((err)=>res.json({err:err.message}))
            ;

         let NAVHistorydata=await results[0][0];
         let pagedetails=await results[0][1];
         let numberdateformatdata=await results[1][0];

         let NAVHistorydataFinal=[];



        if (NAVHistorydata.length>0 && numberdateformatdata.length>0){



             const PRICE= _.find(numberdateformatdata,
                    {COUNTRY_CODE:args.COUNTRY_CODE,LANGUAGE_CODE:args.LANGUAGE_CODE,
                        LABEL_CATEGORY: 'PRICE'});


              const NAV_CHANGE_PERCENT= _.find(numberdateformatdata,
                            {COUNTRY_CODE:args.countrycode,LANGUAGE_CODE:args.languagecode,
                                LABEL_CATEGORY: 'NAV_CHANGE_PERCENT'});


               const CURRENCY_SYMBOL= _.find(numberdateformatdata,
                                    {COUNTRY_CODE:args.countrycode,LANGUAGE_CODE:args.languagecode,
                                        LABEL_CATEGORY: 'CURRENCY_SYMBOL'});

                const FRMT_DATE= _.find(numberdateformatdata,
                                            {COUNTRY_CODE:args.countrycode,LANGUAGE_CODE:args.languagecode,
                                                LABEL_CATEGORY: 'AS_OF_DATE'});



               await NAVHistorydata.map((elem)=>{



            let navobj=elem;



            const nveffdate = (new Date((elem.NAVEFFECTIVE_DATE)));

            const nveffdatefinal=dateFormat(nveffdate,(FRMT_DATE.FMT_DATE).toLowerCase());

            elem.NAVEFFECTIVE_DATE=nveffdatefinal;


            navobj.NAV_CHANGE_VALUE=numformatfn(navobj.NAV_CHANGE_VALUE,
                objprpchk(PRICE,'FMT_DCML_SEP'),objprpchk(PRICE,'FMT_THOUSAND_SEP'),
                    objprpchk(CURRENCY_SYMBOL,'FMT_SYMBL'),objprpchk(PRICE,'FMT_RNDNG'),
                        objprpchk('CURRENCY_SYMBOL','FMT_PRFX_SUFX'));




            navobj.NAV=numformatfn(navobj.NAV,objprpchk(PRICE,'FMT_DCML_SEP'),
                                objprpchk(PRICE,'FMT_THOUSAND_SEP'),
                                    objprpchk(CURRENCY_SYMBOL,'FMT_SYMBL'),objprpchk(PRICE,'FMT_RNDNG'),
                                        objprpchk(CURRENCY_SYMBOL,'FMT_PRFX_SUFX'));



            navobj.DAILY_NAV_CHANGE_PERCENTAGE=numformatfn(navobj.DAILY_NAV_CHANGE_PERCENTAGE,
                objprpchk(NAV_CHANGE_PERCENT,'FMT_DCML_SEP'),
                objprpchk(NAV_CHANGE_PERCENT,'FMT_THOUSAND_SEP'),
                objprpchk(NAV_CHANGE_PERCENT,'FMT_SYMBL'),objprpchk(NAV_CHANGE_PERCENT,'FMT_RNDNG'),
                objprpchk(NAV_CHANGE_PERCENT,'FMT_PRFX_SUFX')
            );



            navobj.REINVESTED_NAV= numformatfn(navobj.REINVESTED_NAV,objprpchk(PRICE,'FMT_DCML_SEP'),
                objprpchk(PRICE,'FMT_THOUSAND_SEP'),
                    objprpchk( CURRENCY_SYMBOL,'FMT_SYMBL'),objprpchk(PRICE,'FMT_RNDNG'),null);

                     NAVHistorydataFinal.push(navobj);

                    //Promise.resolve("Done");



         });
        }
        else if(NAVHistorydata.length>0){
            NAVHistorydataFinal=NAVHistorydata;
        }
        else{
            throw new Error("No Data Exists for given input");
        }


        objfinal={};
        objfinal.NAV=NAVHistorydataFinal;
        objfinal.PageInfo=pagedetails;

        res.status(200).json(objfinal);

        const endtime = new Date();
        console.log("Data Generation completed in  "+(endtime.getTime()-starttime.getTime())+" milliseconds");

        return  await Promise.resolve(objfinal);

    }

catch (err) {

    console.log(err.message)
    res.status(404).json({"Error": err.message});
}

finally {

    console.log("Data Generation completed at "+new Date().toJSON());



}



}
)


/*
app.use(function(err,req,res,next){
    console.log("Error  received from previous middleware.");
    res.status(404).json({"Errorsmessage": err.message});
})
*/
//listen for requests
app.listen(5000,
    function(){
        console.log('now listensing to port '+5001);
    });
